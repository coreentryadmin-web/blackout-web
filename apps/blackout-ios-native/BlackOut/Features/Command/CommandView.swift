import SwiftUI

/// COMMAND — the default market command center (tab 1 of the 5-tab IA).
/// Per docs/ios/INFORMATION-ARCHITECTURE.md the Command tab must answer:
/// what matters right now / what changed / regime / strongest setup / risk /
/// next key level / which product has the most relevant insight.
///
/// Placeholder scaffold today; live-data implementation lands screen by
/// screen as the native repositories bind to the endpoints in
/// docs/ios/API-CONTRACTS.md.
struct CommandView: View {
    var body: some View {
        PlaceholderView(
            title: "Command",
            subtitle: "What matters right now — market regime, top intelligence, and the strongest setup, in one glance.",
            plannedFeatures: [
                "Session header — market status, SPX, SPY, QQQ, VIX, breadth, data connection state, last update",
                "Market regime — gamma / dealer positioning / vol state / trend / breadth / risk / confidence / invalidation",
                "Top intelligence brief — what happened, why it matters, evidence, key level, invalidation, confidence",
                "Active opportunities — top 3–5 setups with entry, invalidation, targets, freshness",
                "What changed — prioritized timeline of meaningful events (not raw alerts)",
                "Product pulse — compact SPX Slayer / Helix / Thermal / Largo / Night Hawk / Vector summaries",
            ]
        )
    }
}
