import XCTest
@testable import BlackOut

final class MarketRegimeFormatterTests: XCTestCase {

    func test_regimeLabel_knownValues() {
        XCTAssertEqual(MarketRegimeFormatter.regimeLabel("positive_gamma"), "Positive gamma")
        XCTAssertEqual(MarketRegimeFormatter.regimeLabel("amplify_mixed"), "Amplify mixed")
    }

    func test_freshnessLabel_justNow() {
        let now = Date()
        XCTAssertEqual(MarketRegimeFormatter.freshnessLabel(now, now: now), "just now")
    }
}
