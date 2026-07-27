import SwiftUI

/// SIGNALS — setup lifecycle: detected → confirming → active → managing →
/// closed → invalidated → graded. Tab 3 of the IA.
///
/// The lifecycle-state enum is the source of truth; UI grouping, filters, and
/// notifications all key off it. Grading (A+/A/B/C/F) attaches to closed
/// setups (from the SPX Slayer + Night Hawk grading engines).
struct SignalsView: View {
    var body: some View {
        PlaceholderView(
            title: "Signals",
            subtitle: "Every setup's lifecycle in one place — from detected to graded.",
            plannedFeatures: [
                "Lifecycle filters — Detected / Confirming / Active / Managing / Closed / Invalidated / Graded",
                "Signal card — ticker, direction, product source, confidence, trigger, entry, invalidation, targets",
                "Signal detail — evidence chain, conflicts, management updates, historical stats",
                "Historical grading — A+/A/B/C/F distribution, MFE/MAE, cohort comparison",
                "Real-time state transitions with haptics and push",
                "Watchlist-triggered signal alerts",
            ]
        )
    }
}
