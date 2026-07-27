import XCTest
@testable import BlackOut

final class FakeMarketRegimeRepo: MarketRegimeRepository, @unchecked Sendable {
    var scripted: [Result<MarketRegime, Error>] = []
    var historyScripted: [Result<[MarketRegime], Error>] = []
    private(set) var calls = 0
    private(set) var historyCalls = 0

    func latest() async throws -> MarketRegime {
        calls += 1
        guard !scripted.isEmpty else { throw APIError.network("no scripted response") }
        return try scripted.removeFirst().get()
    }

    func history(limit: Int) async throws -> [MarketRegime] {
        historyCalls += 1
        guard !historyScripted.isEmpty else { return [] }
        return try historyScripted.removeFirst().get()
    }
}

func sample(regime: String? = "positive_gamma",
            gex: String? = "positive_gamma",
            trend: String? = "up",
            aboveVwap: Bool? = true,
            capturedAt: Date? = Date()) -> MarketRegime {
    MarketRegime(
        available: true,
        regime: regime,
        gexRegime: gex,
        volRegime: "compressed",
        trendRegime: trend,
        flowRegime: "call_dominant",
        playbook: nil,
        capturedAt: capturedAt,
        netGex: 1_500_000_000,
        ivPercentile: 42,
        aboveVwap: aboveVwap,
        stale: false,
        marketOpen: true
    )
}

@MainActor
final class CommandViewModelTests: XCTestCase {

    // MARK: - Formatters

    func test_regimeLabel_mapping() {
        XCTAssertEqual(MarketRegimeFormatter.regimeLabel("positive_gamma"), "Positive gamma")
        XCTAssertEqual(MarketRegimeFormatter.regimeLabel("NEGATIVE_GAMMA"), "Negative gamma")
        XCTAssertEqual(MarketRegimeFormatter.regimeLabel("transition"), "Transition")
        XCTAssertEqual(MarketRegimeFormatter.regimeLabel(nil), "Unknown")
        XCTAssertEqual(MarketRegimeFormatter.regimeLabel("other"), "other")
    }

    func test_priceFormat_handlesNilInfinityAndDigits() {
        XCTAssertEqual(MarketRegimeFormatter.price(nil), "—")
        XCTAssertEqual(MarketRegimeFormatter.price(.infinity), "—")
        XCTAssertEqual(MarketRegimeFormatter.price(.nan), "—")
        // Locale-independent digit count check.
        let s = MarketRegimeFormatter.price(6432.156)
        XCTAssertTrue(s.hasSuffix(".16") || s.hasSuffix(",16"), "2 decimals expected, got \(s)")
    }

    func test_freshnessLabel_buckets() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(nil, now: now), "no timestamp")
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(now.addingTimeInterval(-2), now: now), "just now")
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(now.addingTimeInterval(-30), now: now), "30s ago")
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(now.addingTimeInterval(-90), now: now), "1m ago")
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(now.addingTimeInterval(-3660), now: now), "1h ago")
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(now.addingTimeInterval(-90000), now: now), "1d ago")
        // Clock skew (future timestamp) reads as "just now" rather than negative garbage.
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(now.addingTimeInterval(5), now: now), "just now")
    }

    func test_regimeInterpretation_isNonEmptyForKnownRegimes() {
        for regime in ["positive_gamma", "negative_gamma", "transition"] {
            let text = MarketRegimeFormatter.regimeInterpretation(regime)
            XCTAssertFalse(text.isEmpty, "\(regime) should have an interpretation")
            XCTAssertFalse(text.contains("regime"), "interpretation should be a decision, not the label")
        }
        XCTAssertEqual(MarketRegimeFormatter.regimeInterpretation(nil), "Regime unavailable.")
    }

    // MARK: - ViewModel

    func test_refresh_success_transitionsFromIdleToLoaded() async {
        let repo = FakeMarketRegimeRepo()
        repo.scripted = [.success(sample())]
        let vm = CommandViewModel(repo: repo)
        XCTAssertEqual(vm.state, .idle)
        await vm.refresh()
        if case .loaded(let regime, _) = vm.state {
            XCTAssertEqual(regime.regime, "positive_gamma")
            XCTAssertTrue(regime.available)
        } else {
            XCTFail("expected .loaded, got \(vm.state)")
        }
    }

    func test_refresh_failure_fromIdle_becomesError() async {
        let repo = FakeMarketRegimeRepo()
        repo.scripted = [.failure(APIError.timeout)]
        let vm = CommandViewModel(repo: repo)
        await vm.refresh()
        if case .error(let message) = vm.state {
            XCTAssertTrue(message.lowercased().contains("didn't respond") || message.lowercased().contains("time"),
                         "timeout message should mention timing, got '\(message)'")
        } else {
            XCTFail("expected .error, got \(vm.state)")
        }
    }

    func test_refresh_failureAfterSuccess_keepsPreviousData() async {
        // Premium behavior: never blow away the last-known snapshot on a
        // transient error. Freshness chip carries the age; error card does
        // NOT replace the good data.
        let repo = FakeMarketRegimeRepo()
        repo.scripted = [.success(sample(regime: "positive_gamma")), .failure(APIError.network("offline"))]
        let vm = CommandViewModel(repo: repo)
        await vm.refresh()
        await vm.refresh()
        if case .loaded(let regime, _) = vm.state {
            XCTAssertEqual(regime.regime, "positive_gamma", "must keep previous snapshot on error")
        } else {
            XCTFail("expected .loaded (preserved), got \(vm.state)")
        }
    }

    func test_refresh_multipleSuccesses_updatesData() async {
        let repo = FakeMarketRegimeRepo()
        repo.scripted = [.success(sample(regime: "positive_gamma")), .success(sample(regime: "negative_gamma"))]
        let vm = CommandViewModel(repo: repo)
        await vm.refresh()
        await vm.refresh()
        if case .loaded(let regime, _) = vm.state {
            XCTAssertEqual(regime.regime, "negative_gamma")
        } else {
            XCTFail("expected .loaded second value, got \(vm.state)")
        }
        XCTAssertEqual(repo.calls, 2)
    }

    // MARK: - history

    func test_refreshHistory_populatesHistoryOnSuccess() async {
        let repo = FakeMarketRegimeRepo()
        repo.historyScripted = [.success([sample(regime: "positive_gamma"), sample(regime: "negative_gamma")])]
        let vm = CommandViewModel(repo: repo)
        await vm.refreshHistory()
        XCTAssertEqual(vm.history.count, 2)
        XCTAssertEqual(vm.history[0].regime, "positive_gamma")
    }

    func test_refreshHistory_preservesPreviousOnError() async {
        let repo = FakeMarketRegimeRepo()
        repo.historyScripted = [.success([sample(regime: "positive_gamma")]),
                                 .failure(APIError.network("offline"))]
        let vm = CommandViewModel(repo: repo)
        await vm.refreshHistory()
        await vm.refreshHistory()
        XCTAssertEqual(vm.history.count, 1, "history preserved across transient failure")
    }
}
