import XCTest
import LocalAuthentication
@testable import BlackOut

/// Fake LAContext-alike so we can drive every failure mode without touching
/// the real system prompt. The service (`BiometricGate`) is protocol-driven
/// specifically so this is possible — the tests here are the reason.
final class FakeEvaluator: LAEvaluating {
    var canEvaluate: Bool = true
    var canEvaluateError: Error?
    var evaluateResult: Result<Bool, Error> = .success(true)
    var biometryType: LABiometryType = .faceID

    func canEvaluatePolicy(_ policy: LAPolicy) -> (Bool, Error?) {
        (canEvaluate, canEvaluateError)
    }

    func evaluatePolicy(_ policy: LAPolicy, reason: String) async throws -> Bool {
        try evaluateResult.get()
    }
}

final class BiometricGateTests: XCTestCase {

    // MARK: - availability()

    func test_availability_reportsFaceIDWhenEnrolled() {
        let ev = FakeEvaluator()
        ev.canEvaluate = true
        ev.biometryType = .faceID
        let gate = BiometricGate(evaluatorFactory: { ev })
        XCTAssertEqual(gate.availability(), .available(kind: .faceID))
    }

    func test_availability_reportsNotEnrolledWhenLAErrorNotEnrolled() {
        let ev = FakeEvaluator()
        ev.canEvaluate = false
        ev.canEvaluateError = LAError(.biometryNotEnrolled)
        let gate = BiometricGate(evaluatorFactory: { ev })
        XCTAssertEqual(gate.availability(), .notEnrolled)
    }

    func test_availability_reportsNotAvailableOnHardwareMissing() {
        let ev = FakeEvaluator()
        ev.canEvaluate = false
        ev.canEvaluateError = LAError(.biometryNotAvailable)
        let gate = BiometricGate(evaluatorFactory: { ev })
        XCTAssertEqual(gate.availability(), .notAvailable)
    }

    func test_availability_reportsDeniedOnUserCancelClass() {
        for code in [LAError.Code.userCancel, .userFallback, .appCancel, .systemCancel] {
            let ev = FakeEvaluator()
            ev.canEvaluate = false
            ev.canEvaluateError = LAError(code)
            let gate = BiometricGate(evaluatorFactory: { ev })
            XCTAssertEqual(gate.availability(), .denied, "expected .denied for LAError \(code)")
        }
    }

    // MARK: - unlock()

    func test_unlock_returnsTrueOnSuccess() async throws {
        let ev = FakeEvaluator()
        ev.evaluateResult = .success(true)
        let gate = BiometricGate(evaluatorFactory: { ev })
        let ok = try await gate.unlock(reason: "test")
        XCTAssertTrue(ok)
    }

    func test_unlock_mapsUserCancelToTypedError() async {
        let ev = FakeEvaluator()
        ev.evaluateResult = .failure(LAError(.userCancel))
        let gate = BiometricGate(evaluatorFactory: { ev })
        do {
            _ = try await gate.unlock(reason: "test")
            XCTFail("expected error")
        } catch let err as BiometricUnlockError {
            XCTAssertEqual(err, .userCancelled)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    func test_unlock_mapsBiometryLockoutToTypedError() async {
        let ev = FakeEvaluator()
        ev.evaluateResult = .failure(LAError(.biometryLockout))
        let gate = BiometricGate(evaluatorFactory: { ev })
        do {
            _ = try await gate.unlock(reason: "test")
            XCTFail("expected error")
        } catch let err as BiometricUnlockError {
            XCTAssertEqual(err, .biometryLockout)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    func test_unlock_mapsUnknownErrorToUnknown() async {
        struct WeirdError: Error {}
        let ev = FakeEvaluator()
        ev.evaluateResult = .failure(WeirdError())
        let gate = BiometricGate(evaluatorFactory: { ev })
        do {
            _ = try await gate.unlock(reason: "test")
            XCTFail("expected error")
        } catch let err as BiometricUnlockError {
            if case .unknown = err {} else { XCTFail("expected .unknown, got \(err)") }
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }
}
