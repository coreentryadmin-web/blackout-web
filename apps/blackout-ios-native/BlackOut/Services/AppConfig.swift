import Foundation

/// Static, code-derived configuration the app needs at runtime.
///
/// Rules:
/// - **Never** read a URL/bundle from a scattered call site — go through here
///   so a swap (staging vs prod, custom debug host) is a one-file change.
/// - **No secrets.** The whole config surface is safe to log or inspect;
///   secrets live server-side and the app receives them via authenticated
///   API responses only.
public enum AppConfig {

    /// The BlackOut backend base URL for all API calls. Overridable via
    /// `BLACKOUT_BACKEND_URL` in the app's Info.plist for local runs against
    /// a laptop dev server — production defaults to prod so a shipped IPA
    /// never accidentally talks to staging.
    public static var backendURL: URL {
        if let override = Bundle.main.object(forInfoDictionaryKey: "BLACKOUT_BACKEND_URL") as? String,
           let url = URL(string: override) {
            return url
        }
        // App Transport Security in Info.plist is locked to blackouttrades.com
        // subdomains — a wrong value here would silently 500 on TLS trust, so
        // the compile-time default is a URL that matches ATS exactly.
        return URL(string: "https://blackouttrades.com")!
    }

    /// The bundle identifier — sent to the backend on push registration so
    /// the server picks the right APNs `apns-topic` (production topic vs any
    /// future variant bundle). Read from Info.plist rather than hard-coded so
    /// the value stays true if the bundle id is ever changed.
    public static var bundleIdentifier: String {
        Bundle.main.bundleIdentifier ?? "com.blackout-trades.app"
    }

    /// APNs environment key the server persists next to each device token.
    /// TestFlight + App Store builds use the production APNs environment;
    /// Xcode debug builds use the sandbox. Convention: define
    /// `DEBUG_APNS_SANDBOX` as a Swift compile flag on debug configs only.
    public static var apnsEnvironment: String {
        #if DEBUG_APNS_SANDBOX
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// Version string for the User-Agent / diagnostics — CFBundleShortVersion
    /// (marketing version) + CFBundleVersion (build number) — safe to log.
    public static var appVersion: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }
}
