import Foundation

/// Domain model for a market regime snapshot as delivered by
/// `GET /api/market/regime`. Field names match the API contract exactly so
/// decoding is a straight passthrough — no CodingKeys mapping.
///
/// See docs/ios/API-CONTRACTS.md for the endpoint's full shape; the code path
/// on the server is `src/app/api/market/regime/route.ts`, and NUMERIC values
/// are already rounded/coerced to Doubles there.
public struct MarketRegime: Codable, Equatable, Sendable {
    public let regime: String?              // "positive_gamma" / "negative_gamma" / "transition" / nil
    public let net_gex: Double?             // net dealer gamma exposure, notional $
    public let iv_percentile: Double?       // 0..100 (or null)
    public let flip_level: Double?          // dealer gamma flip strike
    public let call_wall: Double?
    public let put_wall: Double?
    public let spot: Double?                // SPX print
    public let updated_at: Date?
    public let session: String?             // "premarket" / "rth" / "postmarket" / "closed"
    public let session_date: String?        // "YYYY-MM-DD"
}

/// Repository — the SwiftUI view depends on this protocol, not the concrete
/// URLSession-backed impl, so tests inject a fake without hitting the network.
public protocol MarketRegimeRepository: Sendable {
    func latest() async throws -> MarketRegime
}

public struct LiveMarketRegimeRepository: MarketRegimeRepository {
    private let client: APIClient
    public init(client: APIClient = URLSessionAPIClient()) { self.client = client }

    public func latest() async throws -> MarketRegime {
        try await client.get("/api/market/regime", as: MarketRegime.self)
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

    /// Freshness — how long since the API's `updated_at` timestamp. Used in
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
