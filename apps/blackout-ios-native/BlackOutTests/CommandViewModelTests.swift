import XCTest
@testable import BlackOut

final class FakeMarketRegimeRepo: MarketRegimeRepository, @unchecked Sendable {
    var scripted: [Result<MarketRegime, Error>] = []
    private(set) var calls = 0

    func latest() async throws -> MarketRegime {
        calls += 1
        guard !scripted.isEmpty else { throw APIError.network("no scripted response") }
        return try scripted.removeFirst().get()
    }
}

private func sample(regime: String? = "positive_gamma",
                    spot: Double? = 6400,
                    flip: Double? = 6380,
                    call: Double? = 6420,
                    put: Double? = 6350,
                    updatedAt: Date? = Date()) -> MarketRegime {
    MarketRegime(
        regime: regime,
        net_gex: 1_500_000_000,
        iv_percentile: 42,
        flip_level: flip,
        call_wall: call,
        put_wall: put,
        spot: spot,
        updated_at: updatedAt,
        session: "rth",
        session_date: "2026-07-27"
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
            XCTAssertEqual(regime.spot, 6400)
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
        // The premium behavior: never blow away the last-known snapshot on
        // a transient error. Freshness chip will show the age; error card
        // does NOT replace the good data.
        let repo = FakeMarketRegimeRepo()
        repo.scripted = [.success(sample(spot: 6410)), .failure(APIError.network("offline"))]
        let vm = CommandViewModel(repo: repo)
        await vm.refresh()
        await vm.refresh()
        if case .loaded(let regime, _) = vm.state {
            XCTAssertEqual(regime.spot, 6410, "must keep the previous good snapshot on error")
        } else {
            XCTFail("expected .loaded (preserved), got \(vm.state)")
        }
    }

    func test_refresh_multipleSuccesses_updatesData() async {
        let repo = FakeMarketRegimeRepo()
        repo.scripted = [.success(sample(spot: 6400)), .success(sample(spot: 6425))]
        let vm = CommandViewModel(repo: repo)
        await vm.refresh()
        await vm.refresh()
        if case .loaded(let regime, _) = vm.state {
            XCTAssertEqual(regime.spot, 6425)
        } else {
            XCTFail("expected .loaded second value, got \(vm.state)")
        }
        XCTAssertEqual(repo.calls, 2)
    }
}
