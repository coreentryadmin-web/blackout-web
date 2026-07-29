import Foundation

/// Cross-app session state.
///
/// Holds the Clerk `__session` JWT and mirrors it into two places:
///   1. Keychain — so it survives app restarts (see `KeychainStore`).
///   2. `URLSession.shared`'s cookie store — so `APIClient` (which uses
///      `URLSession.shared`) transparently sends `Cookie: __session=<jwt>`
///      on every request. Zero networking-layer changes needed to switch
///      from anonymous → authed reads.
///
/// `@Published var isSignedIn` drives the app's root gate (`SignInView` vs
/// the tabbed shell). All mutation happens on the main actor so SwiftUI
/// re-renders atomically.
@MainActor
public final class SessionStore: ObservableObject {
    /// True whenever we hold a session token. Root view swaps `SignInView`
    /// for the tabbed shell based on this — no gating logic scattered per
    /// tab.
    @Published public private(set) var isSignedIn: Bool = false

    /// Keychain key for the Clerk `__session` token.
    private static let keychainKey = "clerk.session.jwt.v1"

    /// The Clerk cookie name. Must match what the site writes; the native
    /// sign-in bridge (`/native-signin/route.ts`) reads the same cookie
    /// server-side and hands us its value. If Clerk rotates the cookie
    /// convention we adjust here + in the server route together.
    private static let cookieName = "__session"

    /// The host the token is scoped to. Cookie is only attached to requests
    /// against this host + subdomains — matches the site's cookie domain.
    private static let cookieDomain = ".blackouttrades.com"

    public init() {
        // Hydrate from Keychain synchronously so the first SwiftUI render
        // sees the correct `isSignedIn` — no flash of the sign-in screen for
        // a user who's already signed in.
        if let data = KeychainStore.read(for: Self.keychainKey),
           let token = String(data: data, encoding: .utf8), !token.isEmpty {
            installCookie(token: token)
            self.isSignedIn = true
        }
    }

    /// Store a fresh token from the sign-in bridge and go live. Idempotent —
    /// calling with the same token twice is a no-op cookie replacement.
    public func signIn(token: String) {
        guard !token.isEmpty else { return }
        do {
            try KeychainStore.save(Data(token.utf8), for: Self.keychainKey)
        } catch {
            // Keychain write failure is rare (device out of space, corrupted
            // Keychain). We still install the cookie in-memory so the user
            // gets a working session for this app-launch; they'll be asked
            // to sign in again on next launch.
        }
        installCookie(token: token)
        self.isSignedIn = true
    }

    /// Full sign-out: purge Keychain, remove the cookie from URLSession's
    /// jar, flip the gate. All in-flight requests keep their pre-signout
    /// cookie (URLSession snapshots at request time) but next-request
    /// onwards is anonymous.
    public func signOut() {
        KeychainStore.delete(for: Self.keychainKey)
        removeCookie()
        self.isSignedIn = false
    }

    // MARK: - Cookie plumbing

    private func installCookie(token: String) {
        // First remove any stale copy — otherwise HTTPCookieStorage keeps
        // the older one for cookies that differ only in trivial attrs.
        removeCookie()
        let props: [HTTPCookiePropertyKey: Any] = [
            .name: Self.cookieName,
            .value: token,
            .domain: Self.cookieDomain,
            .path: "/",
            .secure: true,
            // JWTs Clerk issues are typically ~1h. Use a 24h expiry on the
            // client cookie so a brief clock skew doesn't drop the cookie
            // mid-session; if the server rejects it as expired we get a 401
            // and hand the user back to the sign-in screen.
            .expires: Date().addingTimeInterval(60 * 60 * 24),
        ]
        if let cookie = HTTPCookie(properties: props) {
            HTTPCookieStorage.shared.setCookie(cookie)
        }
    }

    private func removeCookie() {
        for c in HTTPCookieStorage.shared.cookies ?? [] where c.name == Self.cookieName {
            HTTPCookieStorage.shared.deleteCookie(c)
        }
    }
}
