import Foundation

/// Domain model for a single Signal delivered by `GET /api/mobile/signals`.
/// The endpoint aggregates two sources — SPX Slayer (live 0DTE desk) and
/// Night Hawk (post-close 5-play playbook) — into one tab-facing feed. Every
/// enum here MUST stay 1:1 with `src/lib/mobile/signals-projection.ts`; a
/// mismatch would silently ship as a decode failure in the app binary before
/// the wire failure would.
public struct Signal: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let source: Source
    public let ticker: String
    public let direction: String?
    public let action: String
    public let grade: String?
    public let score: Double?
    public let confidence: Double?
    public let phase: SignalLifecycle
    public let headline: String
    public let thesis: String
    public let entry: LevelValue?
    public let stop: LevelValue?
    public let target: LevelValue?
    public let invalidation: String?
    public let factors: [String]
    public let asOf: Date?
    public let meta: Meta

    public enum Source: String, Codable, Equatable, Sendable {
        case spxSlayer = "SPX_SLAYER"
        case nightHawk = "NIGHT_HAWK"

        public var displayLabel: String {
            switch self {
            case .spxSlayer: return "SPX Slayer"
            case .nightHawk: return "Night Hawk"
            }
        }
    }

    /// Levels come in two shapes: numeric (SPX exact price) OR string
    /// (Night Hawk range like "$500-503"). One Codable that swallows both.
    public enum LevelValue: Equatable, Sendable, Codable {
        case number(Double)
        case text(String)

        public var display: String {
            switch self {
            case .number(let d):
                let f = NumberFormatter()
                f.numberStyle = .decimal
                f.minimumFractionDigits = 2
                f.maximumFractionDigits = 2
                return f.string(from: NSNumber(value: d)) ?? String(d)
            case .text(let s): return s
            }
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let d = try? c.decode(Double.self) { self = .number(d); return }
            if let s = try? c.decode(String.self) { self = .text(s); return }
            throw DecodingError.typeMismatch(
                LevelValue.self,
                .init(codingPath: decoder.codingPath, debugDescription: "not a number or string")
            )
        }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .number(let d): try c.encode(d)
            case .text(let s):   try c.encode(s)
            }
        }
    }

    public struct Meta: Codable, Equatable, Sendable {
        public let conviction: String?
        public let optionsPlay: String?
        public let rank: Int?
        public let pulled: Bool?
        public let pulledReason: String?
        public let gatePromoted: Bool?
        public let ivRank: Double?
        public let flowStreakDays: Int?
        public let editionFor: String?
        public let entryMode: String?
    }
}

/// Response envelope for `GET /api/mobile/signals`.
public struct SignalsFeed: Codable, Equatable, Sendable {
    public let ok: Bool
    public let signals: [Signal]
    public let sources: Sources
    public let fetchedAt: Date?

    public struct Sources: Codable, Equatable, Sendable {
        public let spxSlayer: SpxSlayer
        public let nightHawk: NightHawk

        public struct SpxSlayer: Codable, Equatable, Sendable {
            public let available: Bool
            public let phase: String
            public let action: String
            public let asOf: Date?
        }
        public struct NightHawk: Codable, Equatable, Sendable {
            public let available: Bool
            public let editionFor: String?
            public let publishedAt: Date?
            public let stale: Bool
            public let degraded: Bool
            public let playCount: Int
        }
    }
}

/// Repository — injected as a protocol so tests use a `FakeSignalsRepository`.
public protocol SignalsRepository: Sendable {
    func fetch() async throws -> SignalsFeed
}

public struct LiveSignalsRepository: SignalsRepository {
    private let client: APIClient
    public init(client: APIClient = URLSessionAPIClient()) { self.client = client }
    public func fetch() async throws -> SignalsFeed {
        try await client.get("/api/mobile/signals", as: SignalsFeed.self)
    }
}
