import XCTest
@testable import BlackOut

/// Contract tests for the 5-tab IA. If a tab is added, removed, or renamed,
/// the PR must update this file — which forces a conversation about whether
/// `docs/ios/INFORMATION-ARCHITECTURE.md` should change first.
final class RootViewTests: XCTestCase {

    func test_exactlyFivePrimaryTabs() {
        // Apple HIG + the master prompt both cap the primary tab bar at 5.
        XCTAssertEqual(AppTab.allCases.count, 5)
    }

    func test_tabOrderMatchesIA() {
        // Order is load-bearing: analytics, deep links, and pinned-tab
        // integration tests all key off this exact sequence.
        XCTAssertEqual(AppTab.allCases, [.command, .intelligence, .signals, .watchlist, .account])
    }

    func test_tabSlugs_areStableAndUrlSafe() {
        // Slugs are used in deep-link URLs and analytics events. Any change
        // is a breaking change for both.
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
