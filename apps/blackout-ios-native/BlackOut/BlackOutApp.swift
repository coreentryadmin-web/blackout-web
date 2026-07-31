import SwiftUI

/// BLACKOUT iOS — native SwiftUI app entry point.
///
/// This is the NATIVE app (per docs/ios/PRODUCT-VISION.md + TECHNICAL-ARCHITECTURE.md),
/// distinct from `apps/blackout-ios` which is the transitional Capacitor WebView
/// shell. The two coexist until every product surface documented in the
/// migration plan lands natively; then the WebView shell is retired.
///
/// Architecture: SwiftUI + Observation + structured concurrency + NavigationStack.
/// UIApplicationDelegateAdaptor bridges the tiny amount of UIKit surface we
/// still need (APNs registration callbacks are only delivered to a
/// UIApplicationDelegate — SwiftUI's App lifecycle doesn't expose them).
@main
struct BlackOutApp: App {
    @UIApplicationDelegateAdaptor(BlackOutAppDelegate.self) private var appDelegate
    @StateObject private var appLock = AppLockCoordinator()
    // Cross-device watchlist sync. The store is @MainActor and long-lived
    // for the app's lifetime; passing a URLSession-backed syncer wires it to
    // /api/user/watchlist. Local UserDefaults remains the render source, so
    // the app is instant + offline-safe; hydrate on first .active phase.
    @StateObject private var watchlist = WatchlistStore(sync: URLSessionWatchlistSync())
    @StateObject private var tabRouter = TabRouter()
    // Sign-in state. Hydrates from Keychain on init so a signed-in user
    // never sees the sign-in screen flash on cold launch.
    @StateObject private var session = SessionStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack {
                // Root gate: SignInView when there's no session, tabbed
                // shell otherwise. Gating here (not per-tab) means we never
                // render the tab bar around a broken empty state saying
                // "you need to sign in" — the whole app is either signed
                // in or on the sign-in screen. Simpler mental model + the
                // right UX.
                if session.isSignedIn {
                    RootView()
                } else {
                    SignInView()
                }
                // The lock overlay ALWAYS mounts on top when the coordinator
                // is in a locked/prompting state. Using an overlay (not a
                // sheet or a router branch) keeps the underlying view
                // hierarchy intact, so unlocking doesn't tear down state.
                if appLock.state == .locked || appLock.state == .prompting {
                    AppLockOverlay(coordinator: appLock)
                        .transition(.opacity)
                }
            }
            .animation(BOMotion.contextSwitch, value: appLock.state)
            .animation(BOMotion.contextSwitch, value: session.isSignedIn)
            .environmentObject(appLock)
            .environmentObject(watchlist)
            .environmentObject(tabRouter)
            .environmentObject(session)
            // Handle the callback URL from `blackouttrades.com/native-signin`.
            // ASWebAuthenticationSession's completion handler catches these
            // in SignInView, but we also register here as a defence — some
            // launch flows (Universal Links promotion later, external tap
            // on a share sheet URL) will surface via `.onOpenURL` instead.
            .onOpenURL { url in
                guard url.scheme == "blackout-trades", url.host == "auth" else { return }
                if let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "token" })?.value, !token.isEmpty {
                    session.signIn(token: token)
                }
            }
            // Push-tap deep-linking. AppDelegate parses the tap into a
            // PushDestination on its @Published `pending`; we observe here
            // (App scope, not per-view) and hand off to TabRouter. Consume
            // immediately after routing so a subsequent view re-render
            // can't re-fire the same tap.
            .onReceive(appDelegate.pushRouter.$pending.compactMap { $0 }) { destination in
                tabRouter.route(to: destination.tab, deskModuleId: destination.deskModuleId)
                appDelegate.pushRouter.consume()
            }
            .task {
                await watchlist.hydrateFromServer()
            }
            .preferredColorScheme(.dark)
            .tint(BOColor.textAccent)
            .background(BOColor.backgroundBase.ignoresSafeArea())
            .onChange(of: scenePhase) { _, newPhase in
                // Route ScenePhase to the coordinator. `.inactive` fires just
                // BEFORE the app leaves the foreground (app switcher, control
                // center pull-down) — we lock there so the app-switcher
                // preview doesn't leak the last frame.
                switch newPhase {
                case .active:
                    Task { await appLock.applicationDidBecomeActive() }
                case .inactive, .background:
                    appLock.applicationWillResignActive()
                @unknown default:
                    break
                }
            }
        }
    }
}
