import XCTest
@testable import BlackOut

final class FakeSignalsRepo: SignalsRepository, @unchecked Sendable {
    var scripted: [Result<SignalsFeed, Error>] = []
    private(set) var calls = 0
    func fetch() async throws -> SignalsFeed {
        calls += 1
        guard !scripted.isEmpty else { throw APIError.network("no scripted response") }
        return try scripted.removeFirst().get()
    }
}

private func makeSignal(
    id: String = "s-1",
    source: Signal.Source = .spxSlayer,
    ticker: String = "SPX",
    phase: SignalLifecycle = .active,
    grade: String? = "A",
    score: Double? = 88,
    entry: Signal.LevelValue? = .number(7500),
    stop: Signal.LevelValue? = .number(7488),
    target: Signal.LevelValue? = .number(7520),
    asOf: Date = Date()
) -> Signal {
    Signal(
        id: id,
        source: source,
        ticker: ticker,
        direction: "long",
        action: "BUY",
        grade: grade,
        score: score,
        confidence: 0.7,
        phase: phase,
        headline: "SPX long — VWAP reclaim",
        thesis: "Reclaimed VWAP with flow confirmation.",
        entry: entry,
        stop: stop,
        target: target,
        invalidation: "3m close < VWAP",
        factors: ["Above VWAP", "Positive GEX"],
        asOf: asOf,
        meta: .init(
            conviction: nil, optionsPlay: nil, rank: nil, pulled: nil, pulledReason: nil,
            gatePromoted: nil, ivRank: nil, flowStreakDays: nil, editionFor: nil, entryMode: "hot"
        )
    )
}

private func makeFeed(_ signals: [Signal] = []) -> SignalsFeed {
    SignalsFeed(
        ok: true,
        signals: signals,
        sources: .init(
            spxSlayer: .init(available: true, phase: "OPEN", action: "BUY", asOf: Date()),
            nightHawk: .init(available: true, editionFor: "2026-07-28", publishedAt: Date(), stale: false, degraded: false, playCount: signals.filter { $0.source == .nightHawk }.count)
        ),
        fetchedAt: Date()
    )
}

@MainActor
final class SignalsViewModelTests: XCTestCase {

    // MARK: - State transitions

    func test_idle_thenLoading_thenLoaded_onFirstRefresh() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(makeFeed([makeSignal()]))]
        let vm = SignalsViewModel(repo: repo)
        XCTAssertEqual(vm.state, .idle)
        await vm.refresh()
        guard case .loaded(let feed, _) = vm.state else {
            XCTFail("expected loaded")
            return
        }
        XCTAssertEqual(feed.signals.count, 1)
        XCTAssertEqual(repo.calls, 1)
    }

    func test_error_onFirstRefresh_showsErrorState() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.failure(APIError.notAuthorized)]
        let vm = SignalsViewModel(repo: repo)
        await vm.refresh()
        guard case .error(let msg) = vm.state else {
            XCTFail("expected error state")
            return
        }
        XCTAssertTrue(msg.contains("sign in"), "message should be human: \(msg)")
    }

    // MARK: - Preserve-on-error

    func test_refresh_preservesLastLoadedOnTransientError() async {
        let repo = FakeSignalsRepo()
        let good = makeFeed([makeSignal(id: "keep")])
        repo.scripted = [.success(good), .failure(APIError.timeout)]
        let vm = SignalsViewModel(repo: repo)
        await vm.refresh()
        XCTAssertEqual(vm.state.feed?.signals.first?.id, "keep")
        await vm.refresh()
        // Transient timeout must NOT blank the feed — the freshness chip
        // carries the age; the data itself stays visible.
        XCTAssertEqual(vm.state.feed?.signals.first?.id, "keep",
                       "preserve-on-error violated — the feed blanked on a transient timeout")
    }

    // MARK: - Filter

    func test_filter_appliesClientSide_noExtraFetch() async {
        let repo = FakeSignalsRepo()
        let feed = makeFeed([
            makeSignal(id: "a", phase: .active),
            makeSignal(id: "b", phase: .confirming),
            makeSignal(id: "c", phase: .active),
            makeSignal(id: "d", phase: .invalidated),
        ])
        repo.scripted = [.success(feed)]
        let vm = SignalsViewModel(repo: repo)
        await vm.refresh()
        XCTAssertEqual(vm.visibleSignals.count, 4)
        vm.filter = .active
        XCTAssertEqual(vm.visibleSignals.map(\.id), ["a", "c"])
        vm.filter = .invalidated
        XCTAssertEqual(vm.visibleSignals.map(\.id), ["d"])
        vm.filter = nil
        XCTAssertEqual(vm.visibleSignals.count, 4)
        // Filter changes must NEVER trigger a network fetch.
        XCTAssertEqual(repo.calls, 1)
    }

    // MARK: - LevelValue decode

    func test_levelValue_decodesNumberOrString() throws {
        struct Row: Codable { let v: Signal.LevelValue }
        let asNumber = try JSONDecoder().decode(Row.self, from: Data(#"{"v": 7500.25}"#.utf8))
        if case .number(let n) = asNumber.v { XCTAssertEqual(n, 7500.25) } else { XCTFail() }
        let asString = try JSONDecoder().decode(Row.self, from: Data(#"{"v":"$500-503"}"#.utf8))
        if case .text(let s) = asString.v { XCTAssertEqual(s, "$500-503") } else { XCTFail() }
    }
}
