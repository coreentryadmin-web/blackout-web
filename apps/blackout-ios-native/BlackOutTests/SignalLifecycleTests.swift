import XCTest
@testable import BlackOut

/// Contract for the setup-lifecycle enum. Slugs are load-bearing (analytics,
/// server-side event names, deep-link routes) so a rename or reorder must be
/// deliberate.
final class SignalLifecycleTests: XCTestCase {

    func test_slugs_areStableAndOrderIsCanonical() {
        // Order matches the master prompt Section 6 (Night Hawk lifecycle)
        // and the filter rail's left-to-right rendering.
        XCTAssertEqual(SignalLifecycle.allCases.map(\.rawValue),
                       ["detected", "confirming", "active", "managing", "closed", "invalidated", "graded"])
    }

    func test_labels_areAllPresent() {
        for c in SignalLifecycle.allCases {
            XCTAssertFalse(c.label.isEmpty, "\(c.rawValue) label")
            // No stage should share a display label with another stage — the
            // filter rail relies on visually-distinct labels.
        }
        let labels = SignalLifecycle.allCases.map(\.label)
        XCTAssertEqual(Set(labels).count, labels.count, "labels must be unique")
    }
}
