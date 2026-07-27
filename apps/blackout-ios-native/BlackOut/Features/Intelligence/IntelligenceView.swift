import SwiftUI

/// INTELLIGENCE — coordinated access to the six BLACKOUT intelligence modules
/// (SPX Slayer, Helix, Thermal, Largo, Night Hawk, Vector). Tab 2 of the IA.
///
/// Deliberately NOT a product-per-tab layout: this is the ONE surface where
/// the products live, so they read as coordinated instruments in a system,
/// not competing apps. Each product is a NavigationLink into its own screen
/// once implemented.
struct IntelligenceView: View {
    var body: some View {
        PlaceholderView(
            title: "Intelligence",
            subtitle: "The six BLACKOUT intelligence modules — one surface, coordinated.",
            plannedFeatures: [
                "SPX Slayer — SPX regime + 0DTE decision desk",
                "Helix — institutional options-flow intelligence",
                "BlackOut Thermal — dealer gamma + vanna positioning map",
                "Largo — desk analyst (structure-first, plain-English)",
                "Night Hawk — swing playbook + graded setup log",
                "Vector — cross-ticker gamma-wall radar",
            ]
        )
    }
}
