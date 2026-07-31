import SwiftUI

/// Full-screen signed-in experience — one WKWebView running the same iOS
/// product shell members see in the Capacitor app: native header, instrument
/// rail (SPX · HELIX · Thermal · Largo · Hawk), and live desk content.
/// Uses `BlackOutiOSApp` only (no `BlackOutNativeEmbed`) so web chrome stays visible.
struct IosShellView: View {
    @EnvironmentObject private var router: TabRouter
    @State private var path: String = "/dashboard"

    var body: some View {
        DeskWebView(url: AppConfig.deskURL(path: path), chrome: .iosShell)
            .onChange(of: router.pendingWebPath) { _, pending in
                guard let pending else { return }
                path = pending
                router.consumePendingNavigation()
            }
    }
}
