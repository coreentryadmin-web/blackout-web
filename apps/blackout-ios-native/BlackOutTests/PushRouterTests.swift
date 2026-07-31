import XCTest
@testable import BlackOut

@MainActor
final class PushRouterTests: XCTestCase {

    func test_url_dashboard_opensSpxDesk() {
        let dest = PushRouter.destination(from: ["url": "/dashboard"])
        XCTAssertEqual(dest.webPath, "/dashboard")
    }

    func test_url_allDesks_mapToPaths() {
        let expected = ["/flows", "/heatmap", "/terminal", "/nighthawk", "/vector"]
        for path in expected {
            let dest = PushRouter.destination(from: ["url": path])
            XCTAssertEqual(dest.webPath, path)
        }
    }

    func test_url_account_routesToAccount() {
        XCTAssertEqual(PushRouter.destination(from: ["url": "/account"]).webPath, "/account")
    }

    func test_signalId_spx_routesToDashboard() {
        let dest = PushRouter.destination(from: ["signalId": "spx-open-42"])
        XCTAssertEqual(dest.webPath, "/dashboard")
        XCTAssertEqual(dest.source, .signalId("spx-open-42"))
    }

    func test_signalId_hawk_routesToNightHawk() {
        let dest = PushRouter.destination(from: ["signalId": "hawk-edition-1"])
        XCTAssertEqual(dest.webPath, "/nighthawk")
    }

    func test_explicitTab_desks_withDeskKey() {
        let dest = PushRouter.destination(from: ["tab": "desks", "desk": "helix"])
        XCTAssertEqual(dest.webPath, "/flows")
    }

    func test_explicitTab_signals_routesToNightHawk() {
        XCTAssertEqual(PushRouter.destination(from: ["tab": "signals"]).webPath, "/nighthawk")
    }

    func test_explicitTab_account() {
        XCTAssertEqual(PushRouter.destination(from: ["tab": "account"]).webPath, "/account")
    }

    func test_unknownUrl_fallsBackToDashboard() {
        let dest = PushRouter.destination(from: ["url": "/some-future-desk"])
        XCTAssertEqual(dest.webPath, "/some-future-desk")
    }

    func test_emptyUserInfo_fallsBackToDashboard() {
        XCTAssertEqual(PushRouter.destination(from: [:]).webPath, "/dashboard")
    }

    func test_handleTap_publishesPending_thenConsumeClears() {
        let router = PushRouter()
        XCTAssertNil(router.pending)
        router.handleTap(userInfo: ["url": "/heatmap"])
        XCTAssertEqual(router.pending?.webPath, "/heatmap")
        router.consume()
        XCTAssertNil(router.pending)
    }

    func test_deskModuleId_fromPaths() {
        XCTAssertEqual(PushRouter.deskModuleId(from: "/dashboard?ticker=SPX"), "spx-slayer")
        XCTAssertNil(PushRouter.deskModuleId(from: "/account"))
    }
}
