import SwiftUI

/// Per-desk detail screen. Loads the live web desk in an embedded WKWebView
/// with the user's Clerk session — same data members see on blackouttrades.com,
/// styled for iOS via the `BlackOutNativeEmbed` user-agent token. Native
/// SwiftUI implementations replace each desk one at a time per
/// TECHNICAL-ARCHITECTURE.md; until then this bridge keeps TestFlight usable.
public struct ProductDetailView: View {
    let module: IntelligenceModule

    public init(module: IntelligenceModule) { self.module = module }

    public var body: some View {
        DeskWebView(url: AppConfig.deskURL(path: module.webPath))
            .navigationTitle(module.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
    }
}
