import XCTest
@testable import BlackOut

@MainActor
final class WatchlistStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUpWithError() throws {
        suiteName = "blackout.watchlist.tests." + UUID().uuidString
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
    }

    // MARK: - normalize (pure function)

    func test_normalize_upperCasesAndTrims() {
        XCTAssertEqual(WatchlistStore.normalize("  spx  "), "SPX")
        XCTAssertEqual(WatchlistStore.normalize("nvda"), "NVDA")
        XCTAssertEqual(WatchlistStore.normalize("BRK.B"), "BRK.B")
    }

    func test_normalize_rejectsInvalid() {
        XCTAssertNil(WatchlistStore.normalize(""), "empty string")
        XCTAssertNil(WatchlistStore.normalize("   "), "whitespace only")
        XCTAssertNil(WatchlistStore.normalize("NINECHARSSS"), "too long")
        XCTAssertNil(WatchlistStore.normalize("SP X"), "internal space")
        XCTAssertNil(WatchlistStore.normalize("SPX!"), "special char")
        XCTAssertNil(WatchlistStore.normalize(".BRKB"), "leading dot")
        XCTAssertNil(WatchlistStore.normalize("BRKB."), "trailing dot")
        XCTAssertNil(WatchlistStore.normalize("BR..KB"), "double dot")
    }

    // MARK: - add / remove / dedupe

    func test_add_returnsNormalizedAndPersists() {
        let store = WatchlistStore(defaults: defaults)
        XCTAssertEqual(store.add("spy"), "SPY")
        XCTAssertEqual(store.tickers, ["SPY"])
        // Persisted — a fresh instance sees the same list.
        let reload = WatchlistStore(defaults: defaults)
        XCTAssertEqual(reload.tickers, ["SPY"])
    }

    func test_add_duplicateReturnsNil_leavesListUnchanged() {
        let store = WatchlistStore(defaults: defaults)
        _ = store.add("SPX")
        XCTAssertNil(store.add("spx"), "second add of same normalized ticker returns nil")
        XCTAssertEqual(store.tickers, ["SPX"], "list not duplicated")
    }

    func test_add_invalidReturnsNil() {
        let store = WatchlistStore(defaults: defaults)
        XCTAssertNil(store.add(""))
        XCTAssertNil(store.add("BAD!TICKER"))
        XCTAssertEqual(store.tickers, [])
    }

    func test_remove_deletesAndPersists() {
        let store = WatchlistStore(defaults: defaults)
        _ = store.add("SPX")
        _ = store.add("SPY")
        store.remove("spx")
        XCTAssertEqual(store.tickers, ["SPY"])
        let reload = WatchlistStore(defaults: defaults)
        XCTAssertEqual(reload.tickers, ["SPY"])
    }

    func test_contains_isCaseInsensitive() {
        let store = WatchlistStore(defaults: defaults)
        _ = store.add("QQQ")
        XCTAssertTrue(store.contains("qqq"))
        XCTAssertFalse(store.contains("IWM"))
    }

    func test_move_reorders() {
        let store = WatchlistStore(defaults: defaults)
        _ = store.add("SPX")
        _ = store.add("SPY")
        _ = store.add("NVDA")
        store.move(from: IndexSet(integer: 2), to: 0)
        XCTAssertEqual(store.tickers, ["NVDA", "SPX", "SPY"])
    }
}
