import SwiftUI

/// Embeds a member-facing web page (Learn, FAQ, Account settings) inside
/// native navigation. Uses the same Clerk session + embed user-agent as desks.
struct WebUtilityView: View {
    let title: String
    let path: String

    var body: some View {
        DeskWebView(url: AppConfig.deskURL(path: path))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
    }
}
