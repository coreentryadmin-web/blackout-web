import Foundation

/// Domain model for a market regime snapshot as delivered by
/// `GET /api/market/regime`. Field names are camelCase to match the ACTUAL
/// API response shape (verified against
/// `src/app/api/market/regime/route.ts` — the route explicitly camelCases
/// the DB row before serialising it).
///
/// EARLIER MISTAKE (fixed 2026-07-27): a first pass of this file used
/// invented snake_case field names (`flip_level`, `call_wall`, etc.) that
/// the endpoint does NOT return. Those were left over from a wrong reading
/// of the DB schema; the JSON contract is what the API actually serves.
/// Walls / flip / spot live in `/api/market/gex-positioning`, not here —
/// wired via a separate repository when that view lands.
public struct MarketRegime: Codable, Equatable, Sendable {
    /// Always present. `false` means "we have no snapshot at all" (cold DB /
    /// pre-first-cron); UI shows the loading skeleton state.
    public let available: Bool

    /// Composite regime label, e.g. "positive_gamma" / "negative_gamma" /
    /// "transition". Nil off-hours or before the first cron of the day.
    public let regime: String?

    /// Sub-regime components. Any of these may be nil.
    public let gexRegime: String?
    public let volRegime: String?
    public let trendRegime: String?
    public let flowRegime: String?

    /// Plain-English "what to do" text stored with the snapshot (server-owned
    /// so language changes there without an app release).
    public let playbook: String?

    public let capturedAt: Date?
    public let netGex: Double?
    public let ivPercentile: Double?
    public let aboveVwap: Bool?

    /// True when the server determines the snapshot is old (off-hours,
    /// weekend, cron outage). Never present stale data as live — use this
    /// to caption the freshness chip. Master prompt Section 17.
    public let stale: Bool?
    /// Whether the US cash session is currently open. Independent of `stale`.
    public let marketOpen: Bool?
}

/// Response envelope for `GET /api/market/regime/history?limit=N`.
public struct MarketRegimeHistory: Codable, Equatable, Sendable {
    public let snapshots: [MarketRegime]
}

/// Repository — the SwiftUI view depends on this protocol, not the concrete
/// URLSession-backed impl, so tests inject a fake without hitting the network.
public protocol MarketRegimeRepository: Sendable {
    func latest() async throws -> MarketRegime
    /// Most recent `limit` snapshots, newest first. Used by the Command
    /// "What Changed" timeline. Callers typically ask for 8–16.
    func history(limit: Int) async throws -> [MarketRegime]
}

public struct LiveMarketRegimeRepository: MarketRegimeRepository {
    private let client: APIClient
    public init(client: APIClient = URLSessionAPIClient()) { self.client = client }

    public func latest() async throws -> MarketRegime {
        try await client.get("/api/market/regime", as: MarketRegime.self)
    }

    public func history(limit: Int) async throws -> [MarketRegime] {
        let bounded = max(1, min(limit, 50))
        let envelope: MarketRegimeHistory = try await client.get(
            "/api/market/regime?history=\(bounded)", as: MarketRegimeHistory.self
        )
        return envelope.snapshots
    }
}

// MARK: - Human formatting helpers (view layer uses these; kept here so
// snapshot tests can verify the labels without a SwiftUI render).

public enum MarketRegimeFormatter {
    /// Plain-English label for the current regime, matching the tone we
    /// want in the Command header (institutional, not shouting).
    public static func regimeLabel(_ regime: String?) -> String {
        switch regime?.lowercased() {
        case "positive_gamma": return "Positive gamma"
        case "negative_gamma": return "Negative gamma"
        case "transition":     return "Transition"
        case nil, "":          return "Unknown"
        default:               return regime ?? "Unknown"
        }
    }

    /// One-line interpretation of the regime — the concrete implication a
    /// user actually acts on. Institutional wording, no market-cheer.
    public static func regimeInterpretation(_ regime: String?) -> String {
        switch regime?.lowercased() {
        case "positive_gamma":
            return "Dealer hedging suppresses moves. Expect chop; breakouts fade back to structure."
        case "negative_gamma":
            return "Dealer hedging amplifies moves. Expect trend; breakouts extend."
        case "transition":
            return "Regime is unstable — treat both sides as tradeable, size down."
        default:
            return "Regime unavailable."
        }
    }

    /// Compact price label for the session header (e.g., 6,432.15).
    /// Falls back to em-dash for `nil` so the layout doesn't collapse.
    public static func price(_ value: Double?) -> String {
        guard let v = value, v.isFinite else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: v)) ?? "—"
    }

    /// Freshness — how long since the API's `capturedAt` timestamp. Used in
    /// the "last update" chip in the session header. Contract: NEVER present
    /// stale data as live, per master prompt Section 17.
    public static func freshnessLabel(_ updatedAt: Date?, now: Date = Date()) -> String {
        guard let updatedAt else { return "no timestamp" }
        let seconds = Int(now.timeIntervalSince(updatedAt))
        if seconds < 0 { return "just now" } // clock skew defence
        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        return "\(days)d ago"
    }
}
