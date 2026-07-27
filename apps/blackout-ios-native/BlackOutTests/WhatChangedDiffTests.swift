import XCTest
@testable import BlackOut

final class WhatChangedDiffTests: XCTestCase {

    func test_emptyOnFewerThanTwoSnapshots() {
        XCTAssertTrue(WhatChangedDiff.compute([]).isEmpty)
        XCTAssertTrue(WhatChangedDiff.compute([sample(regime: "positive_gamma")]).isEmpty)
    }

    func test_detectsCompositeTransition() {
        let newer = sample(regime: "negative_gamma")
        let older = sample(regime: "positive_gamma")
        let changes = WhatChangedDiff.compute([newer, older])
        XCTAssertEqual(changes.count, 1)
        XCTAssertEqual(changes[0].field, .composite)
        XCTAssertEqual(changes[0].from, "positive_gamma")
        XCTAssertEqual(changes[0].to, "negative_gamma")
    }

    func test_detectsMultipleFieldsChangedInOneStep() {
        let newer = sample(regime: "negative_gamma", gex: "negative_gamma", trend: "down", aboveVwap: false)
        let older = sample(regime: "positive_gamma", gex: "positive_gamma", trend: "up",   aboveVwap: true)
        let changes = WhatChangedDiff.compute([newer, older])
        // Composite + gex + trend + vwap all changed; vol/flow same → 4 changes.
        XCTAssertEqual(changes.count, 4)
        let fields = Set(changes.map(\.field))
        XCTAssertEqual(fields, [.composite, .gex, .trend, .vwap])
    }

    func test_stableRegimeReturnsNoChanges() {
        let a = sample()
        let b = sample()
        XCTAssertTrue(WhatChangedDiff.compute([a, b]).isEmpty)
    }

    func test_capsAtMax() {
        // 5 different composites → 4 transitions across pairs; ask for max 2.
        let ss = ["a", "b", "c", "d", "e"].map { sample(regime: $0) }
        let changes = WhatChangedDiff.compute(ss, max: 2)
        XCTAssertLessThanOrEqual(changes.count, 2)
    }

    func test_orderIsNewestFirst() {
        // Two transitions: newer→middle (composite a→b), middle→older (composite b→c).
        // Snapshots are newest-first from the API, so the first change in the
        // output should correspond to the pair (snapshots[0], snapshots[1]).
        let newer  = sample(regime: "a")
        let middle = sample(regime: "b")
        let older  = sample(regime: "c")
        let changes = WhatChangedDiff.compute([newer, middle, older])
        XCTAssertEqual(changes.first?.to, "a")
        XCTAssertEqual(changes.first?.from, "b")
    }

    func test_vwapMapsBoolToLabel() {
        let newer = sample(aboveVwap: false)
        let older = sample(aboveVwap: true)
        let changes = WhatChangedDiff.compute([newer, older])
        let vwap = changes.first(where: { $0.field == .vwap })
        XCTAssertEqual(vwap?.from, "above VWAP")
        XCTAssertEqual(vwap?.to,   "below VWAP")
    }
}
