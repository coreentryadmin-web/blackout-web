import XCTest
@testable import BlackOut

final class FakeWatchlistSync: WatchlistSyncing, @unchecked Sendable {
    var remote: [String]? = nil
    private(set) var pushCalls: [[String]] = []
    /// Optional server transform applied to pushed tickers (simulates the
    /// server's normalize/dedupe/cap step) so tests can prove echoed lists
    /// are respected by the client.
    var pushEcho: (([String]) -> [String])? = nil

    func fetchRemote() async -> [String]? { remote }

    func pushLocal(_ tickers: [String]) async -> [String]? {
        pushCalls.append(tickers)
        if let e = pushEcho { return e(tickers) }
        return tickers
    }
}

@MainActor
final class WatchlistSyncTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUpWithError() throws {
        suiteName = "blackout.watchlist.sync.tests." + UUID().uuidString
        defaults = UserDefaults(suiteName: suiteName)
    }
    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
    }

    // MARK: - hydrateFromServer

    func test_hydrate_setsDidInitialSyncEvenWhenNoSyncInjected() async {
        let store = WatchlistStore(defaults: defaults)
        XCTAssertFalse(store.didInitialSync)
        await store.hydrateFromServer()
        XCTAssertTrue(store.didInitialSync)
    }

    func test_hydrate_overwritesLocalWhenRemoteDiffers() async {
        let sync = FakeWatchlistSync()
        sync.remote = ["SPX", "NVDA"]
        let store = WatchlistStore(defaults: defaults, sync: sync)
        _ = store.add("SPY") // local pre-existing list
        XCTAssertEqual(store.tickers, ["SPY"])
        await store.hydrateFromServer()
        XCTAssertEqual(store.tickers, ["SPX", "NVDA"], "server wins on first hydration (last-write-wins)")
        XCTAssertTrue(store.didInitialSync)
    }

    func test_hydrate_doesNothingWhenRemoteMatchesLocal() async {
        let sync = FakeWatchlistSync()
        sync.remote = ["SPX"]
        let store = WatchlistStore(defaults: defaults, sync: sync)
        _ = store.add("SPX")
        await store.hydrateFromServer()
        XCTAssertEqual(store.tickers, ["SPX"])
    }

    func test_hydrate_keepsLocalWhenRemoteFetchFails() async {
        let sync = FakeWatchlistSync()
        sync.remote = nil // simulates network/auth failure
        let store = WatchlistStore(defaults: defaults, sync: sync)
        _ = store.add("SPY")
        await store.hydrateFromServer()
        XCTAssertEqual(store.tickers, ["SPY"], "local list preserved when server is unreachable")
        XCTAssertTrue(store.didInitialSync, "even a failed pull marks the initial sync as attempted")
    }

    // MARK: - push after mutation

    func test_add_pushesToServer() async {
        let sync = FakeWatchlistSync()
        let store = WatchlistStore(defaults: defaults, sync: sync)
        _ = store.add("SPX")
        // Yield so the fire-and-forget Task on persist() gets a chance to run.
        await Task.yield()
        // The async push happens in a detached Task; give it a beat.
        try? await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(sync.pushCalls, [["SPX"]])
    }

    func test_serverEchoRewritesLocalWhenDifferent() async {
        // If the server normalizes/reorders/dedupes, the client must adopt
        // the server's canonical list so the two stay in sync.
        let sync = FakeWatchlistSync()
        sync.pushEcho = { input in input.map { $0.uppercased() }.sorted() } // simulate a reorder
        let store = WatchlistStore(defaults: defaults, sync: sync)
        _ = store.add("SPY")
        _ = store.add("SPX")
        try? await Task.sleep(nanoseconds: 80_000_000)
        // After both adds, server echo reorders to ["SPX", "SPY"]; local
        // list should end up matching.
        XCTAssertEqual(store.tickers, ["SPX", "SPY"])
    }
}
