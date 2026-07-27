import XCTest
@testable import BlackOut

@MainActor
final class PushRouterTests: XCTestCase {

    // MARK: - Explicit tab wins

    func test_explicitTab_key_routesToNamedTab() {
        let dest = PushRouter.destination(from: ["tab": "watchlist"])
        XCTAssertEqual(dest.tab, .watchlist)
        XCTAssertEqual(dest.source, .explicitTab)
    }

    func test_explicitTab_key_isCaseInsensitive() {
        XCTAssertEqual(PushRouter.destination(from: ["tab": "SIGNALS"]).tab, .signals)
        XCTAssertEqual(PushRouter.destination(from: ["tab": "Command"]).tab, .command)
    }

    func test_explicitTab_key_wins_over_url() {
        // Server intent (tab) MUST outrank URL heuristics — otherwise a
        // future URL that gets re-mapped to a different tab would silently
        // ignore the server's explicit routing.
        let dest = PushRouter.destination(from: [
            "tab": "watchlist",
            "url": "/nighthawk",
        ])
        XCTAssertEqual(dest.tab, .watchlist)
    }

    // MARK: - Signal-specific pushes

    func test_signalId_routesToSignalsTab() {
        let dest = PushRouter.destination(from: ["signalId": "spx-open-42"])
        XCTAssertEqual(dest.tab, .signals)
        if case .signalId(let id) = dest.source {
            XCTAssertEqual(id, "spx-open-42")
        } else { XCTFail("expected signalId source, got \(dest.source)") }
    }

    func test_signalId_ignored_when_empty() {
        // An empty string is server accidents; treat as no signalId and
        // fall through to the URL / fallback paths.
        let dest = PushRouter.destination(from: [
            "signalId": "",
            "url": "/dashboard",
        ])
        XCTAssertEqual(dest.tab, .command,
                       "empty signalId should fall through, not force Signals tab")
    }

    // MARK: - URL heuristics

    func test_url_dashboard_routesToCommand() {
        XCTAssertEqual(PushRouter.destination(from: ["url": "/dashboard"]).tab, .command)
        XCTAssertEqual(PushRouter.destination(from: ["url": "/dashboard?ticker=SPX"]).tab, .command,
                       "prefix match — query string preserved but doesn't change routing")
    }

    func test_url_nighthawk_routesToSignals() {
        XCTAssertEqual(PushRouter.destination(from: ["url": "/nighthawk"]).tab, .signals)
    }

    func test_url_desks_routeToIntelligence() {
        // All non-SPX / non-NightHawk desks live under Intelligence tab.
        for path in ["/flows", "/heatmap", "/vector", "/terminal"] {
            XCTAssertEqual(
                PushRouter.destination(from: ["url": path]).tab,
                .intelligence,
                "\(path) should route to Intelligence tab"
            )
        }
    }

    func test_url_watchlist_and_account() {
        XCTAssertEqual(PushRouter.destination(from: ["url": "/watchlist"]).tab, .watchlist)
        XCTAssertEqual(PushRouter.destination(from: ["url": "/account"]).tab, .account)
    }

    // MARK: - Fallbacks

    func test_unknownUrl_fallsBackToCommand() {
        // A URL we don't recognise (future desk not yet mapped, weird path)
        // must land somewhere useful — Command is the default tab.
        let dest = PushRouter.destination(from: ["url": "/some-future-desk"])
        XCTAssertEqual(dest.tab, .command)
        XCTAssertEqual(dest.source, .fallback)
    }

    func test_emptyUserInfo_fallsBackToCommand() {
        let dest = PushRouter.destination(from: [:])
        XCTAssertEqual(dest.tab, .command)
        XCTAssertEqual(dest.source, .fallback)
    }

    // MARK: - Publisher behavior

    func test_handleTap_publishesPending_thenConsumeClears() {
        let router = PushRouter()
        XCTAssertNil(router.pending)
        router.handleTap(userInfo: ["url": "/heatmap"])
        XCTAssertEqual(router.pending?.tab, .intelligence)
        router.consume()
        XCTAssertNil(router.pending, "consume() must clear pending so a re-render doesn't re-fire the tap")
    }
}
