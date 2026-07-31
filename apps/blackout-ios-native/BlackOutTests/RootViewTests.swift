import XCTest
@testable import BlackOut

final class RootViewTests: XCTestCase {

    func test_exactlyFourPrimaryTabs() {
        XCTAssertEqual(AppTab.allCases.count, 4)
    }

    func test_tabOrderMatchesIA() {
        XCTAssertEqual(AppTab.allCases, [.desks, .signals, .watchlist, .account])
    }

    func test_tabSlugs_areStableAndUrlSafe() {
        for tab in AppTab.allCases {
            XCTAssertEqual(tab.rawValue, tab.rawValue.lowercased(), "\(tab) slug must be lowercase")
            XCTAssertFalse(tab.rawValue.contains(" "), "\(tab) slug must not contain spaces")
            XCTAssertTrue(tab.rawValue.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" }, "\(tab) slug must be URL-safe")
        }
    }

    func test_everyTab_hasNonEmptyTitleAndSystemImage() {
        for tab in AppTab.allCases {
            XCTAssertFalse(tab.title.isEmpty, "\(tab) missing title")
            XCTAssertFalse(tab.systemImage.isEmpty, "\(tab) missing systemImage")
        }
    }
}
