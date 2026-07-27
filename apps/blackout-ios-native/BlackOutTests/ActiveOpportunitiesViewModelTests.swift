import XCTest
@testable import BlackOut

private func opp(
    id: String,
    ticker: String,
    phase: SignalLifecycle,
    score: Double?,
    source: Signal.Source = .spxSlayer
) -> Signal {
    Signal(
        id: id,
        source: source,
        ticker: ticker,
        direction: "long",
        action: "BUY",
        grade: "A",
        score: score,
        confidence: nil,
        phase: phase,
        headline: "\(ticker) headline",
        thesis: "",
        entry: nil,
        stop: nil,
        target: nil,
        invalidation: nil,
        factors: [],
        asOf: Date(),
        meta: .init(
            conviction: nil, optionsPlay: nil, rank: nil, pulled: nil, pulledReason: nil,
            gatePromoted: nil, ivRank: nil, flowStreakDays: nil, editionFor: nil, entryMode: nil
        )
    )
}

private func feedWith(_ signals: [Signal]) -> SignalsFeed {
    SignalsFeed(
        ok: true,
        signals: signals,
        sources: .init(
            spxSlayer: .init(available: true, phase: "OPEN", action: "BUY", asOf: Date()),
            nightHawk: .init(available: true, editionFor: "2026-07-28", publishedAt: Date(), stale: false, degraded: false, playCount: 0)
        ),
        fetchedAt: Date()
    )
}

@MainActor
final class ActiveOpportunitiesViewModelTests: XCTestCase {

    func test_topOpportunities_filtersToActionableStagesOnly() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(feedWith([
            opp(id: "a", ticker: "NVDA", phase: .active, score: 80),
            opp(id: "b", ticker: "TSLA", phase: .detected, score: 90),   // filtered out
            opp(id: "c", ticker: "AMZN", phase: .invalidated, score: 95),// filtered out
            opp(id: "d", ticker: "MSFT", phase: .confirming, score: 70),
            opp(id: "e", ticker: "AAPL", phase: .managing, score: 60),
            opp(id: "f", ticker: "AMZN", phase: .graded, score: 99),      // filtered out
        ]))]
        let vm = ActiveOpportunitiesViewModel(repo: repo)
        await vm.refresh()
        let ids = Set(vm.topOpportunities(limit: 5).map(\.id))
        XCTAssertEqual(ids, ["a", "d", "e"])
    }

    func test_topOpportunities_dedupesByTicker_higherScoreWins() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(feedWith([
            opp(id: "a1", ticker: "NVDA", phase: .active, score: 70, source: .spxSlayer),
            opp(id: "a2", ticker: "NVDA", phase: .active, score: 90, source: .nightHawk),
            opp(id: "b",  ticker: "TSLA", phase: .active, score: 65),
        ]))]
        let vm = ActiveOpportunitiesViewModel(repo: repo)
        await vm.refresh()
        let picks = vm.topOpportunities(limit: 3)
        XCTAssertEqual(picks.count, 2, "one row per ticker — no duplicate NVDAs on the summary")
        XCTAssertEqual(picks.first?.id, "a2", "the higher-scoring NVDA row must win")
    }

    func test_topOpportunities_capsAtLimit_sortedByScoreDesc() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(feedWith([
            opp(id: "a", ticker: "A", phase: .active, score: 50),
            opp(id: "b", ticker: "B", phase: .active, score: 95),
            opp(id: "c", ticker: "C", phase: .active, score: 70),
            opp(id: "d", ticker: "D", phase: .active, score: 20),
        ]))]
        let vm = ActiveOpportunitiesViewModel(repo: repo)
        await vm.refresh()
        XCTAssertEqual(vm.topOpportunities(limit: 3).map(\.ticker), ["B", "C", "A"])
    }

    func test_preserveOnError_keepsLastLoaded() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [
            .success(feedWith([opp(id: "keep", ticker: "NVDA", phase: .active, score: 80)])),
            .failure(APIError.timeout),
        ]
        let vm = ActiveOpportunitiesViewModel(repo: repo)
        await vm.refresh()
        await vm.refresh()
        XCTAssertEqual(vm.topOpportunities(limit: 1).first?.id, "keep",
                       "a transient timeout must NOT blank the summary card")
    }
}
