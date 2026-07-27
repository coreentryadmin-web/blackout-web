import XCTest
import UserNotifications
@testable import BlackOut

// MARK: - Fakes

final class FakeAuthorizer: NotificationAuthorizer, @unchecked Sendable {
    var currentStatus: UNAuthorizationStatus = .notDetermined
    var requestResult: Result<Bool, Error> = .success(true)
    private(set) var requestedOptions: UNAuthorizationOptions?

    func authorizationStatus() async -> UNAuthorizationStatus { currentStatus }

    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        requestedOptions = options
        let ok = try requestResult.get()
        // Mirror the real UN behaviour — a "granted" answer flips the OS
        // status to authorized before the async return resolves.
        if ok { currentStatus = .authorized } else { currentStatus = .denied }
        return ok
    }
}

@MainActor
final class FakeRegistrar: RemoteNotificationRegistrar {
    private(set) var didRegister = 0
    private(set) var didUnregister = 0
    func registerForRemoteNotifications() { didRegister += 1 }
    func unregisterForRemoteNotifications() { didUnregister += 1 }
}

final class RecordingBackend: BackendRegistering, @unchecked Sendable {
    private(set) var registerCalls: [(token: String, bundle: String, env: String)] = []
    private(set) var unregisterCalls: [String] = []
    var registerError: Error?
    var unregisterError: Error?

    func register(deviceTokenHex: String, bundleId: String, environment: String) async throws {
        if let e = registerError { throw e }
        registerCalls.append((deviceTokenHex, bundleId, environment))
    }
    func unregister(deviceTokenHex: String) async throws {
        if let e = unregisterError { throw e }
        unregisterCalls.append(deviceTokenHex)
    }
}

// MARK: - Tests

@MainActor
final class PushRegistrationServiceTests: XCTestCase {

    func test_requestAuthorizationAndRegister_success_triggersRemoteRegistration() async throws {
        let auth = FakeAuthorizer()
        let reg = FakeRegistrar()
        let back = RecordingBackend()
        let svc = PushRegistrationService(authorizer: auth, registrar: reg, backend: back)

        let status = try await svc.requestAuthorizationAndRegister()
        XCTAssertEqual(status, .authorized)
        XCTAssertEqual(reg.didRegister, 1, "should call registerForRemoteNotifications after grant")
        XCTAssertEqual(reg.didUnregister, 0)
        XCTAssertTrue(auth.requestedOptions?.contains(.alert) ?? false)
        XCTAssertTrue(auth.requestedOptions?.contains(.sound) ?? false)
        XCTAssertTrue(auth.requestedOptions?.contains(.badge) ?? false)
        // We deliberately don't request criticalAlert or provisional (see service comment).
        XCTAssertFalse(auth.requestedOptions?.contains(.criticalAlert) ?? true)
        XCTAssertFalse(auth.requestedOptions?.contains(.provisional) ?? true)
    }

    func test_requestAuthorizationAndRegister_denied_throwsTypedError() async {
        let auth = FakeAuthorizer()
        auth.requestResult = .success(false)
        let svc = PushRegistrationService(authorizer: auth, registrar: FakeRegistrar(), backend: RecordingBackend())

        do {
            _ = try await svc.requestAuthorizationAndRegister()
            XCTFail("expected authorizationDenied")
        } catch let e as PushRegistrationError {
            XCTAssertEqual(e, .authorizationDenied)
        } catch {
            XCTFail("wrong error type: \(error)")
        }
    }

    func test_registerToken_hexEncodesAndForwardsToBackend() async {
        let back = RecordingBackend()
        let svc = PushRegistrationService(authorizer: FakeAuthorizer(), registrar: FakeRegistrar(), backend: back)

        // A minimal 4-byte "token" so the hex encoding is easy to check.
        let bytes: [UInt8] = [0xDE, 0xAD, 0xBE, 0xEF]
        await svc.registerToken(Data(bytes))

        XCTAssertEqual(back.registerCalls.count, 1)
        XCTAssertEqual(back.registerCalls[0].token, "deadbeef")
        XCTAssertEqual(back.registerCalls[0].bundle, AppConfig.bundleIdentifier)
        // Prod is the compile-time default (no DEBUG_APNS_SANDBOX flag set for tests).
        XCTAssertEqual(back.registerCalls[0].env, "production")
    }

    func test_registerToken_swallowsBackendErrors() async {
        struct BoomError: Error {}
        let back = RecordingBackend()
        back.registerError = BoomError()
        let svc = PushRegistrationService(authorizer: FakeAuthorizer(), registrar: FakeRegistrar(), backend: back)

        // Must not throw — a network hiccup during token registration
        // shouldn't kill the app. The failure is logged and forgotten.
        await svc.registerToken(Data([0x01, 0x02]))
        XCTAssertTrue(back.registerCalls.isEmpty)
    }

    func test_unregister_deletesFromBackendAndTellsOS() async {
        let back = RecordingBackend()
        let reg = FakeRegistrar()
        let svc = PushRegistrationService(authorizer: FakeAuthorizer(), registrar: reg, backend: back)

        await svc.unregister(tokenData: Data([0xA1, 0xB2]))
        XCTAssertEqual(back.unregisterCalls, ["a1b2"])
        XCTAssertEqual(reg.didUnregister, 1)
    }

    func test_unregister_withoutTokenStillCallsOS() async {
        let back = RecordingBackend()
        let reg = FakeRegistrar()
        let svc = PushRegistrationService(authorizer: FakeAuthorizer(), registrar: reg, backend: back)

        await svc.unregister(tokenData: nil)
        XCTAssertTrue(back.unregisterCalls.isEmpty, "no token → no backend call")
        XCTAssertEqual(reg.didUnregister, 1, "still tell iOS to stop delivering remote notifications")
    }

    func test_status_translatesEveryUNAuthorizationCase() async {
        let mapping: [(UNAuthorizationStatus, PushAuthorizationStatus)] = [
            (.notDetermined, .notDetermined),
            (.denied, .denied),
            (.authorized, .authorized),
            (.provisional, .provisional),
            (.ephemeral, .ephemeral),
        ]
        for (raw, expected) in mapping {
            let auth = FakeAuthorizer()
            auth.currentStatus = raw
            let svc = PushRegistrationService(authorizer: auth, registrar: FakeRegistrar(), backend: RecordingBackend())
            let got = await svc.status()
            XCTAssertEqual(got, expected, "expected \(expected) for \(raw)")
        }
    }
}
