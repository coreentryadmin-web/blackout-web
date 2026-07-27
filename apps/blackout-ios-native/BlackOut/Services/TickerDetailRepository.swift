import Foundation

/// Per-ticker dealer-positioning detail from `GET /api/mobile/ticker/{TICKER}`.
///
/// Two-case enum on the wire (available vs not) — a fresh ticker just added
/// to the watchlist may not have a positioning matrix yet, and the app must
/// render that as a legitimate "not covered" state rather than an error.
/// Every field is optional even in the available case because the source
/// gex-positioning payload evolves: adding a new lens (charm, vanna, dex)
/// server-side must not break the app decoder.
public struct TickerDetail: Codable, Equatable, Sendable {
    public let ok: Bool
    public let available: Bool
    public let ticker: String
    public let reason: String?
    public let spot: Double?
    public let changePct: Double?
    public let asOf: Date?
    public let levels: Levels?
    public let regime: Regime?
    public let degraded: Bool?
    public let fetchedAt: Date?

    public struct Levels: Codable, Equatable, Sendable {
        public let flip: Double?
        public let callWall: Double?
        public let putWall: Double?
        public let maxPain: Double?
        public let nearestWall: NearestWall?
    }
    public struct NearestWall: Codable, Equatable, Sendable {
        public let strike: Double
        public let kind: String   // "call" | "put"
        public let distancePts: Double
    }
    public struct Regime: Codable, Equatable, Sendable {
        public let gamma: String?          // "positive_gamma" | "negative_gamma" | "transition"
        public let posture: String?        // "long" | "short"
        public let interpretation: String?
    }
}

public protocol TickerDetailRepository: Sendable {
    func fetch(_ ticker: String) async throws -> TickerDetail
}

public struct LiveTickerDetailRepository: TickerDetailRepository {
    private let client: APIClient
    public init(client: APIClient = URLSessionAPIClient()) { self.client = client }
    public func fetch(_ ticker: String) async throws -> TickerDetail {
        // Percent-encode the ticker path segment — BRK.B is legal on our
        // regex but the "." would collapse a URL if not encoded consistently.
        let safe = ticker.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ticker
        return try await client.get("/api/mobile/ticker/\(safe)", as: TickerDetail.self)
    }
}
