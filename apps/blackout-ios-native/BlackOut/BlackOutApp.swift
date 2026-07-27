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
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView()
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
            .environmentObject(appLock)
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
