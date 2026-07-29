import SwiftUI
import AuthenticationServices

/// Landing screen shown when there's no active session.
///
/// One button: "Sign in with BlackOut". Tapping it opens the site's
/// `/native-signin` bridge in an `ASWebAuthenticationSession` — a system-
/// managed Safari sheet that shares cookies with Safari (so a user already
/// signed in on the web finishes without re-entering credentials) but is
/// scoped to the app.
///
/// The bridge redirects to `blackout-trades://auth?token=<jwt>` once the
/// Clerk session cookie is available; `ASWebAuthenticationSession` catches
/// the callback URL and hands it to us — we extract the token and pass it
/// to `SessionStore`.
struct SignInView: View {
    @EnvironmentObject private var session: SessionStore

    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: BOSpacing.block) {
            Spacer(minLength: BOSpacing.block)

            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                Text("BLACKOUT")
                    .font(BOFont.label)
                    .tracking(2.4)
                    .textCase(.uppercase)
                    .foregroundStyle(BOColor.textCaption)
                Text("Trade like the lights are on.")
                    .font(BOFont.heading1)
                    .foregroundStyle(BOColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Six coordinated intelligence modules — dealer positioning, options flow, 0DTE, gamma walls, and the graded playbook — one live desk.")
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, BOSpacing.hairline)
            }

            Spacer()

            VStack(alignment: .leading, spacing: BOSpacing.snug) {
                Button(action: startSignIn) {
                    HStack(spacing: BOSpacing.unit) {
                        if isSigningIn {
                            ProgressView().tint(BOColor.backgroundBase)
                        } else {
                            Image(systemName: "lock.shield.fill")
                                .font(.system(size: 15, weight: .semibold))
                        }
                        Text(isSigningIn ? "Opening…" : "Sign in with BlackOut")
                            .font(BOFont.bodyBold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: BORadius.chip, style: .continuous)
                            .fill(BOColor.textAccent)
                    )
                    .foregroundStyle(BOColor.backgroundBase)
                }
                .buttonStyle(.plain)
                .disabled(isSigningIn)

                if let msg = errorMessage {
                    HStack(alignment: .top, spacing: BOSpacing.unit) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.statusCaution)
                        Text(msg)
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textSecondary)
                    }
                }

                Text("You'll sign in with your existing BlackOut account. New here? Tap Sign in and select Create account.")
                    .font(BOFont.caption)
                    .foregroundStyle(BOColor.textCaption)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, BOSpacing.hairline)
            }
        }
        .padding(BOSpacing.comfortable)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(BOColor.backgroundBase.ignoresSafeArea())
    }

    // MARK: - Web sign-in launcher

    private func startSignIn() {
        errorMessage = nil
        isSigningIn = true

        // Live site is the source of truth. In DEBUG we still hit prod
        // because there's no staging web (see CLAUDE.md — staging was
        // decommissioned 2026-07-25).
        let signInURL = URL(string: "https://blackouttrades.com/native-signin")!

        let anchor = SignInPresentationAnchor()
        let session = ASWebAuthenticationSession(
            url: signInURL,
            callbackURLScheme: "blackout-trades"
        ) { callback, error in
            Task { @MainActor in
                self.isSigningIn = false
                if let error = error as NSError? {
                    // User-cancelled is not a failure — just close silently.
                    if error.domain == ASWebAuthenticationSessionError.errorDomain &&
                        error.code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        return
                    }
                    self.errorMessage = "Sign in didn't complete. \(error.localizedDescription)"
                    return
                }
                guard let callback,
                      let comps = URLComponents(url: callback, resolvingAgainstBaseURL: false),
                      let token = comps.queryItems?.first(where: { $0.name == "token" })?.value,
                      !token.isEmpty else {
                    self.errorMessage = "Sign in completed but the session token didn't come back. Try again."
                    return
                }
                self.session.signIn(token: token)
            }
        }
        session.presentationContextProvider = anchor
        // Prefer ephemeral session so cookies from a Safari sign-in don't
        // leak back into Safari itself. Users who are already signed in on
        // web will re-authenticate here once — worth the trade for cleanliness.
        session.prefersEphemeralWebBrowserSession = false
        session.start()
        // Keep the anchor alive for the duration of the session. Nil after
        // completion via the completion handler's implicit capture.
        // (`session` retains its context provider internally.)
    }
}

/// Presentation anchor for `ASWebAuthenticationSession`. Returns the app's
/// key window so the sheet mounts on top of the sign-in screen.
private final class SignInPresentationAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes
        if let scene = scenes.compactMap({ $0 as? UIWindowScene }).first,
           let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
            return window
        }
        // Fallback — shouldn't hit this in practice (there's always a scene
        // when the user taps a button in the running app), but returning a
        // fresh UIWindow keeps the API contract.
        return UIWindow()
    }
}
