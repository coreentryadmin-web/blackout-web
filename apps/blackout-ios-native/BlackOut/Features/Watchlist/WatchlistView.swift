import SwiftUI

/// WATCHLIST — personalized tickers, saved filters, monitored levels, and
/// per-ticker alert conditions. Tab 4 of the IA.
///
/// State lives server-side (bound to the Clerk user) so the same watchlist
/// appears on web + native + notification routing. Local sync is optimistic.
struct WatchlistView: View {
    var body: some View {
        PlaceholderView(
            title: "Watchlist",
            subtitle: "Your tickers, saved filters, monitored levels, and alert conditions.",
            plannedFeatures: [
                "Ticker list — spot, session change, gamma regime badge, flow badge",
                "Ticker detail — chart, flow, gamma structure, news catalysts, alerts",
                "Alert builder — level cross, wall proximity, regime flip, flow anomaly",
                "Saved filters — Helix, Thermal, Night Hawk scanner presets",
                "Quiet hours + per-product notification tuning",
                "Watchlist sync across web + native (same Clerk user)",
            ]
        )
    }
}
