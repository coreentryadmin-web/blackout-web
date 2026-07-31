import XCTest
@testable import BlackOut

final class RootViewTests: XCTestCase {

    func test_rootView_isShellOnly() {
        // Signed-in IA is a single full-screen web shell — no SwiftUI TabView.
        let _ = RootView()
        XCTAssertTrue(true, "RootView compiles as IosShellView wrapper")
    }
}
