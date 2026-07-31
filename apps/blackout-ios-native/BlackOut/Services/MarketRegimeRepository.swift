import Foundation

public struct MarketRegime: Codable, Equatable, Sendable {
    public let available: Bool
    public let regime: String?
    public let gexRegime: String?
    public let volRegime: String?
    public let trendRegime: String?
    public let flowRegime: String?
    public let playbook: String?
    public let capturedAt: Date?
    public let netGex: Double?
    public let ivPercentile: Double?
    public let aboveVwap: Bool?
    public let stale: Bool?
    public let marketOpen: Bool?
}

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

public enum MarketRegimeFormatter {
    public static func regimeLabel(_ regime: String?) -> String {
        switch regime?.lowercased() {
        case "positive_gamma": return "Positive gamma"
        case "negative_gamma": return "Negative gamma"
        case "transition":     return "Transition"
        case "amplify_mixed", "amplification": return "Amplify mixed"
        case nil, "":          return "Unknown"
        default:
            return regime?
                .replacingOccurrences(of: "_", with: " ")
                .capitalized ?? "Unknown"
        }
    }

    public static func regimeInterpretation(_ regime: String?) -> String {
        switch regime?.lowercased() {
        case "positive_gamma":
            return "Dealer hedging suppresses moves. Expect chop; breakouts fade back to structure."
        case "negative_gamma", "amplification", "amplify_mixed":
            return "Dealer hedging amplifies moves. Expect trend; breakouts extend."
        case "transition":
            return "Regime is unstable — treat both sides as tradeable, size down."
        default:
            return "Regime unavailable."
        }
    }

    public static func freshnessLabel(_ updatedAt: Date?, now: Date = Date()) -> String {
        guard let updatedAt else { return "no timestamp" }
        let seconds = Int(now.timeIntervalSince(updatedAt))
        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        return "\(hours / 24)d ago"
    }
}
