import SwiftUI

/// ACCOUNT — subscription, notifications, security, education, support, legal,
/// and data status. Tab 5 of the IA.
///
/// This screen is where Face ID app-lock lives (N-1), where APNs preferences
/// live (N-2), where the reader-app "membership managed on web" affordance
/// lives (App Store 3.1.1 — no purchase CTA here, ever).
struct AccountView: View {
    var body: some View {
        PlaceholderView(
            title: "Account",
            subtitle: "Membership, security, notifications, and settings.",
            plannedFeatures: [
                "Profile — email + tier from Clerk (read-only in-app; managed on web)",
                "Membership — tier, renewal, 'managed on the web' with an Open Web button (no in-app purchase — 3.1.1)",
                "Security — Face ID app-lock toggle, session management, sign out everywhere",
                "Notifications — APNs per-product, per-ticker, quiet hours, confidence threshold",
                "Data status — provider health, last-updated per source, freshness diagnostics",
                "Education — Learn hub, glossary, product tours",
                "Support — contact, feedback, privacy, terms, account deletion",
            ]
        )
    }
}
