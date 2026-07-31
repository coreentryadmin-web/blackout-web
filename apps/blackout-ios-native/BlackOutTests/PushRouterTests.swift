import XCTest
@testable import BlackOut

@MainActor
final class PushRouterTests: XCTestCase {

    func test_explicitTab_key_routesToNamedTab() {
        let dest = PushRouter.destination(from: ["tab": "account"])
        XCTAssertEqual(dest.tab, .account)
        XCTAssertEqual(dest.source, .explicitTab)
    }

    func test_explicitTab_key_isCaseInsensitive() {
        XCTAssertEqual(PushRouter.destination(from: ["tab": "DESKS"]).tab, .desks)
        XCTAssertEqual(PushRouter.destination(from: ["tab": "Account"]).tab, .account)
    }

    func test_explicitTab_withDeskKey() {
        let dest = PushRouter.destination(from: ["tab": "desks", "desk": "helix"])
        XCTAssertEqual(dest.tab, .desks)
        XCTAssertEqual(dest.deskModuleId, "helix")
    }

    func test_signalId_routesToDesksWithModule() {
        let dest = PushRouter.destination(from: ["signalId": "spx-open-42"])
        XCTAssertEqual(dest.tab, .desks)
        XCTAssertEqual(dest.deskModuleId, "spx-slayer")
    }

    func test_signalId_hawk_routesToNightHawk() {
        let dest = PushRouter.destination(from: ["signalId": "hawk-edition-1"])
        XCTAssertEqual(dest.deskModuleId, "night-hawk")
    }

    func test_url_dashboard_opensSpxDesk() {
        let dest = PushRouter.destination(from: ["url": "/dashboard"])
        XCTAssertEqual(dest.tab, .desks)
        XCTAssertEqual(dest.deskModuleId, "spx-slayer")
    }

    func test_url_allDesks_mapToRegistryIds() {
        let expected: [(String, String)] = [
            ("/flows", "helix"),
            ("/heatmap", "thermal"),
            ("/terminal", "largo"),
            ("/nighthawk", "night-hawk"),
            ("/vector", "vector"),
        ]
        for (path, id) in expected {
            let dest = PushRouter.destination(from: ["url": path])
            XCTAssertEqual(dest.tab, .desks, path)
            XCTAssertEqual(dest.deskModuleId, id, path)
        }
    }

    func test_url_account_routesToAccountTab() {
        XCTAssertEqual(PushRouter.destination(from: ["url": "/account"]).tab, .account)
    }

    func test_unknownUrl_fallsBackToSpxDesk() {
        let dest = PushRouter.destination(from: ["url": "/some-future-desk"])
        XCTAssertEqual(dest.tab, .desks)
        XCTAssertEqual(dest.deskModuleId, "spx-slayer")
        XCTAssertEqual(dest.source, .fallback)
    }

    func test_emptyUserInfo_fallsBackToSpxDesk() {
        let dest = PushRouter.destination(from: [:])
        XCTAssertEqual(dest.tab, .desks)
        XCTAssertEqual(dest.deskModuleId, "spx-slayer")
    }

    func test_handleTap_publishesPending_thenConsumeClears() {
        let router = PushRouter()
        XCTAssertNil(router.pending)
        router.handleTap(userInfo: ["url": "/heatmap"])
        XCTAssertEqual(router.pending?.tab, .desks)
        XCTAssertEqual(router.pending?.deskModuleId, "thermal")
        router.consume()
        XCTAssertNil(router.pending)
    }

    func test_deskModuleId_fromPaths() {
        XCTAssertEqual(PushRouter.deskModuleId(from: "/dashboard?ticker=SPX"), "spx-slayer")
        XCTAssertNil(PushRouter.deskModuleId(from: "/account"))
    }
}
