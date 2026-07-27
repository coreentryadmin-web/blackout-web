import XCTest
@testable import BlackOut

final class FakeTickerDetailRepo: TickerDetailRepository, @unchecked Sendable {
    var scripted: [Result<TickerDetail, Error>] = []
    private(set) var calls: [String] = []
    func fetch(_ ticker: String) async throws -> TickerDetail {
        calls.append(ticker)
        guard !scripted.isEmpty else { throw APIError.network("no scripted response") }
        return try scripted.removeFirst().get()
    }
}

private func availableDetail(_ ticker: String = "NVDA") -> TickerDetail {
    TickerDetail(
        ok: true, available: true, ticker: ticker, reason: nil,
        spot: 178.20, changePct: 1.24, asOf: Date(),
        levels: .init(
            flip: 176.00, callWall: 180.00, putWall: 172.00, maxPain: 175.00,
            nearestWall: .init(strike: 180.00, kind: "call", distancePts: 1.80)
        ),
        regime: .init(
            gamma: "positive_gamma", posture: "long",
            interpretation: "Dealer hedging suppresses moves."
        ),
        degraded: false, fetchedAt: Date()
    )
}

private func unavailableDetail(_ ticker: String = "NEWCO") -> TickerDetail {
    TickerDetail(
        ok: true, available: false, ticker: ticker,
        reason: "no dealer positioning available yet",
        spot: nil, changePct: nil, asOf: nil,
        levels: nil, regime: nil, degraded: nil,
        fetchedAt: Date()
    )
}

@MainActor
final class TickerDetailViewModelTests: XCTestCase {

    func test_refresh_loadsAvailableDetail() async {
        let repo = FakeTickerDetailRepo()
        repo.scripted = [.success(availableDetail())]
        let vm = TickerDetailViewModel(ticker: "NVDA", repo: repo)
        await vm.refresh()
        guard case .loaded(let d, _) = vm.state else {
            XCTFail("expected loaded"); return
        }
        XCTAssertEqual(d.ticker, "NVDA")
        XCTAssertEqual(d.available, true)
        XCTAssertEqual(d.spot, 178.20)
        XCTAssertEqual(d.levels?.flip, 176.00)
        XCTAssertEqual(d.regime?.gamma, "positive_gamma")
        XCTAssertEqual(repo.calls, ["NVDA"])
    }

    func test_refresh_loadsUnavailable_asFirstClassState() async {
        // "not covered yet" is a legitimate load, not an error. The sheet
        // should render the empty state, not the error card.
        let repo = FakeTickerDetailRepo()
        repo.scripted = [.success(unavailableDetail())]
        let vm = TickerDetailViewModel(ticker: "NEWCO", repo: repo)
        await vm.refresh()
        guard case .loaded(let d, _) = vm.state else {
            XCTFail("expected loaded (unavailable is not an error)"); return
        }
        XCTAssertEqual(d.available, false)
        XCTAssertNotNil(d.reason)
    }

    func test_preserveOnError_keepsLastLoaded() async {
        let repo = FakeTickerDetailRepo()
        let good = availableDetail()
        repo.scripted = [.success(good), .failure(APIError.timeout)]
        let vm = TickerDetailViewModel(ticker: "NVDA", repo: repo)
        await vm.refresh()
        XCTAssertEqual(vm.state.detail?.spot, 178.20)
        await vm.refresh()
        XCTAssertEqual(vm.state.detail?.spot, 178.20,
                       "transient timeout must NOT blank the sheet")
    }

    func test_firstRefreshError_showsHumanMessage() async {
        let repo = FakeTickerDetailRepo()
        repo.scripted = [.failure(APIError.forbidden)]
        let vm = TickerDetailViewModel(ticker: "NVDA", repo: repo)
        await vm.refresh()
        guard case .error(let msg) = vm.state else {
            XCTFail("expected error state"); return
        }
        XCTAssertTrue(msg.contains("Premium"),
                      "403 message should mention Premium so the user knows how to unblock — got: \(msg)")
    }

    func test_decodesTwoShapes_fromRawJson() throws {
        // Wire-format check: both shapes decode. If the endpoint's Codable
        // ever drifts from the app's model, this test fails loud before it
        // reaches production.
        let available = Data(#"""
        {
          "ok": true,
          "available": true,
          "ticker": "SPY",
          "spot": 623.20,
          "changePct": 0.24,
          "asOf": "2026-07-27T14:12:00Z",
          "levels": {
            "flip": 620.5,
            "callWall": 625.0,
            "putWall": 615.0,
            "maxPain": 618.0,
            "nearestWall": { "strike": 625.0, "kind": "call", "distancePts": 1.8 }
          },
          "regime": {
            "gamma": "positive_gamma",
            "posture": "long",
            "interpretation": "Dealer hedging suppresses moves."
          },
          "degraded": false,
          "fetchedAt": "2026-07-27T14:12:03Z"
        }
        """#.utf8)
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        let d1 = try dec.decode(TickerDetail.self, from: available)
        XCTAssertEqual(d1.available, true)
        XCTAssertEqual(d1.levels?.nearestWall?.kind, "call")

        let unavailable = Data(#"""
        {
          "ok": true,
          "available": false,
          "ticker": "NEWCO",
          "reason": "no dealer positioning available yet",
          "fetchedAt": "2026-07-27T14:12:03Z"
        }
        """#.utf8)
        let d2 = try dec.decode(TickerDetail.self, from: unavailable)
        XCTAssertEqual(d2.available, false)
        XCTAssertEqual(d2.reason, "no dealer positioning available yet")
        XCTAssertNil(d2.levels)
    }
}
