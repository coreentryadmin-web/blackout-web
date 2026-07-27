import Foundation

/// Single-ticker spot quote from `GET /api/market/quote?ticker=X`.
///
/// The endpoint always returns 200 — a failure or empty is
/// `{ available: false, ticker }` so the model always decodes. Callers check
/// `available` before rendering price; a false value maps to "—" in the UI,
/// never a zero that would read as a real $0 quote.
public struct TickerQuote: Codable, Equatable, Sendable {
    public let available: Bool
    public let ticker: String
    public let price: Double?
    public let changePct: Double?
    public let source: String?
    public let asof: Date?

    enum CodingKeys: String, CodingKey {
        case available, ticker, price, source, asof
        case changePct = "change_pct"
    }
}

public protocol QuoteRepository: Sendable {
    func fetch(_ ticker: String) async throws -> TickerQuote
}

public struct LiveQuoteRepository: QuoteRepository {
    private let client: APIClient
    public init(client: APIClient = URLSessionAPIClient()) { self.client = client }
    public func fetch(_ ticker: String) async throws -> TickerQuote {
        // Path-encode the ticker so unusual characters (BRK.B) survive.
        let safe = ticker.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ticker
        return try await client.get("/api/market/quote?ticker=\(safe)", as: TickerQuote.self)
    }
}
