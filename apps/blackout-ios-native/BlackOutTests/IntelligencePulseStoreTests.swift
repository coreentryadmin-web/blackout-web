import XCTest
@testable import BlackOut

private func pulseSignal(source: Signal.Source, phase: SignalLifecycle, grade: String?, direction: String? = "long") -> Signal {
    Signal(
        id: "\(source.rawValue)-\(phase.rawValue)",
        source: source,
        ticker: source == .spxSlayer ? "SPX" : "NVDA",
        direction: direction,
        action: phase == .active ? "BUY" : "SCANNING",
        grade: grade,
        score: 88,
        confidence: 0.6,
        phase: phase,
        headline: "",
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

private func pulseFeed(
    spxSignal: Signal? = nil,
    spxAvailable: Bool = true,
    spxPhase: String = "OPEN",
    nhAvailable: Bool = true,
    nhCount: Int = 5,
    nhStale: Bool = false,
    nhDegraded: Bool = false
) -> SignalsFeed {
    SignalsFeed(
        ok: true,
        signals: spxSignal.map { [$0] } ?? [],
        sources: .init(
            spxSlayer: .init(available: spxAvailable, phase: spxPhase, action: "BUY", asOf: Date()),
            nightHawk: .init(available: nhAvailable, editionFor: nil, publishedAt: nil, stale: nhStale, degraded: nhDegraded, playCount: nhCount)
        ),
        fetchedAt: Date()
    )
}

@MainActor
final class IntelligencePulseStoreTests: XCTestCase {

    func test_pulse_returnsNilBeforeAnyFetch() {
        let store = IntelligencePulseStore(repo: FakeSignalsRepo())
        XCTAssertNil(store.pulse(for: "spx-slayer"))
        XCTAssertNil(store.pulse(for: "night-hawk"))
    }

    func test_pulse_forSpxSlayer_composesFromSignalWhenPresent() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(pulseFeed(spxSignal: pulseSignal(source: .spxSlayer, phase: .active, grade: "A+")))]
        let store = IntelligencePulseStore(repo: repo)
        await store.refresh()
        let p = store.pulse(for: "spx-slayer")
        XCTAssertEqual(p?.label, "ACTIVE · A+ · LONG")
        XCTAssertEqual(p?.tint, .positive)
    }

    func test_pulse_forSpxSlayer_fallsBackToSourcesPhase_whenNoSignal() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(pulseFeed(spxAvailable: true, spxPhase: "SCANNING"))]
        let store = IntelligencePulseStore(repo: repo)
        await store.refresh()
        let p = store.pulse(for: "spx-slayer")
        XCTAssertEqual(p?.label, "SCANNING")
        XCTAssertEqual(p?.tint, .informational)
    }

    func test_pulse_forSpxSlayer_showsOfflineWhenSourcesUnavailable() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(pulseFeed(spxAvailable: false))]
        let store = IntelligencePulseStore(repo: repo)
        await store.refresh()
        XCTAssertEqual(store.pulse(for: "spx-slayer")?.label, "Offline")
    }

    func test_pulse_forNightHawk_countsPluralization_andStaleBadge() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(pulseFeed(nhCount: 5))]
        let store = IntelligencePulseStore(repo: repo)
        await store.refresh()
        XCTAssertEqual(store.pulse(for: "night-hawk")?.label, "5 plays")

        let repo2 = FakeSignalsRepo()
        repo2.scripted = [.success(pulseFeed(nhCount: 1))]
        let store2 = IntelligencePulseStore(repo: repo2)
        await store2.refresh()
        XCTAssertEqual(store2.pulse(for: "night-hawk")?.label, "1 play",
                       "singular vs plural — no '1 plays' typo on a one-play edition")

        let repo3 = FakeSignalsRepo()
        repo3.scripted = [.success(pulseFeed(nhCount: 3, nhStale: true))]
        let store3 = IntelligencePulseStore(repo: repo3)
        await store3.refresh()
        XCTAssertEqual(store3.pulse(for: "night-hawk")?.label, "3 plays · stale")
        XCTAssertEqual(store3.pulse(for: "night-hawk")?.tint, .caution)
    }

    func test_pulse_returnsNilForModulesWithoutAggregatorHitYet() async {
        let repo = FakeSignalsRepo()
        repo.scripted = [.success(pulseFeed())]
        let store = IntelligencePulseStore(repo: repo)
        await store.refresh()
        // These four modules don't have a mobile aggregator yet — nil so
        // the row falls back to its static tagline instead of a
        // "placeholder" label that would clutter the summary.
        for id in ["helix", "thermal", "largo", "vector"] {
            XCTAssertNil(store.pulse(for: id), "\(id) should fall back to static tagline, not a placeholder pulse")
        }
    }

    func test_preserveOnError_keepsLastFeed() async {
        let repo = FakeSignalsRepo()
        let good = pulseFeed(spxSignal: pulseSignal(source: .spxSlayer, phase: .active, grade: "A"))
        repo.scripted = [.success(good), .failure(APIError.timeout)]
        let store = IntelligencePulseStore(repo: repo)
        await store.refresh()
        XCTAssertNotNil(store.pulse(for: "spx-slayer"))
        await store.refresh()
        // Timeout must NOT blank the pulse — the freshness on the underlying
        // feed carries the age.
        XCTAssertNotNil(store.pulse(for: "spx-slayer"))
    }
}
