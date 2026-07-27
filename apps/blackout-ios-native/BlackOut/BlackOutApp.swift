import SwiftUI

/// BLACKOUT iOS — native SwiftUI app entry point.
///
/// This is the NATIVE app (per docs/ios/PRODUCT-VISION.md + TECHNICAL-ARCHITECTURE.md),
/// distinct from `apps/blackout-ios` which is the transitional Capacitor WebView
/// shell. The two coexist until every product surface documented in the
/// migration plan lands natively; then the WebView shell is retired.
///
/// Architecture: SwiftUI + Observation + structured concurrency + NavigationStack.
/// No AppDelegate — pure SwiftUI lifecycle. The 5-tab IA is defined in
/// `RootView`; every tab is one root screen so state is scoped and back-stacks
/// are independent (Apple HIG for TabView).
@main
struct BlackOutApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark) // BlackOut is a dark-only product surface.
                .tint(BOColor.textAccent)     // System-level accent for iOS chrome (nav-back tint, etc).
                .background(BOColor.backgroundBase.ignoresSafeArea())
        }
    }
}
