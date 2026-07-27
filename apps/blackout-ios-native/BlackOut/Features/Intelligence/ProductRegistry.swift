import SwiftUI

/// The six BLACKOUT intelligence modules, in the ORDER they appear on the
/// Intelligence tab. Order matches the master prompt's Section 6
/// (SPX Slayer → Helix → Thermal → Largo → Night Hawk → Vector), which is
/// intentional: SPX Slayer first because it's the highest-usage desk during
/// RTH, Vector last because it's a cross-ticker view most users only reach
/// after they've committed to a directional read from the others.
///
/// Identity fields (accent color, product mark, tagline) must match:
///   - the web IOS_TOOLS registry (src/lib/ios-tool-routes.ts) hex-for-hex,
///   - the marketing product descriptions (src/lib/marketing/products.ts),
///   - the design system per-desk accents (BOColor.Product.*).
public struct IntelligenceModule: Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
    public let mark: String          // 2-3 char product mark (SPX, HLX, THM, LRG, HWK, VEC)
    public let systemImage: String   // SF Symbol
    public let accent: Color
    public let tagline: String       // one line, institutional tone
    public let purpose: String       // one paragraph describing what it does
    public let webPath: String       // path on the live site (for the "Open on web" fallback)
}

public enum IntelligenceRegistry {
    public static let all: [IntelligenceModule] = [
        IntelligenceModule(
            id: "spx-slayer",
            name: "SPX Slayer",
            mark: "SPX",
            systemImage: "target",
            accent: BOColor.Product.spxSlayer,
            tagline: "SPX regime · 0DTE decision desk",
            purpose: "The SPX market-structure command surface. Dealer flip, walls, opening range, and the graded 0DTE play read with entry, target, stop, and invalidation.",
            webPath: "/dashboard"
        ),
        IntelligenceModule(
            id: "helix",
            name: "Helix",
            mark: "HLX",
            systemImage: "waveform.path.ecg",
            accent: BOColor.Product.helix,
            tagline: "Institutional options-flow tape",
            purpose: "Tick-by-tick unusual options activity with sweep-vs-block detection, premium filters, and anomaly scoring. Each event explains why it matters.",
            webPath: "/flows"
        ),
        IntelligenceModule(
            id: "thermal",
            name: "BlackOut Thermal",
            mark: "THM",
            systemImage: "flame",
            accent: BOColor.Product.thermal,
            tagline: "Dealer gamma + vanna map",
            purpose: "GEX / VEX / DEX / charm across strikes and expiries. See where dealers are pinned, where hedging accelerates, and where volatility can expand.",
            webPath: "/heatmap"
        ),
        IntelligenceModule(
            id: "largo",
            name: "Largo",
            mark: "LRG",
            systemImage: "brain.head.profile",
            accent: BOColor.Product.largo,
            tagline: "Desk analyst — plain English",
            purpose: "Ask about flow, gamma, or regime and get a structure-first read grounded in the same live data as your other tools. Never invents data; distinguishes fact / interpretation / conflict.",
            webPath: "/terminal"
        ),
        IntelligenceModule(
            id: "night-hawk",
            name: "Night Hawk",
            mark: "HWK",
            systemImage: "moon.stars",
            accent: BOColor.Product.nightHawk,
            tagline: "Swing playbook · A–F graded",
            purpose: "The evening swing scanner + graded play log. Every setup carries the full thesis, confluence score, entry framework, invalidation, and final grade after close.",
            webPath: "/nighthawk"
        ),
        IntelligenceModule(
            id: "vector",
            name: "Vector",
            mark: "VEC",
            systemImage: "chart.xyaxis.line",
            accent: BOColor.Product.vector,
            tagline: "Gamma-wall radar · cross-ticker",
            purpose: "Live gamma-wall structure across the universe of optionable tickers. Watch support, resistance, and the dealer flip as they form intraday.",
            webPath: "/vector"
        ),
    ]
}
