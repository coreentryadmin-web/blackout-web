import Foundation
import UIKit
import UserNotifications
import os

/// Native APNs push registration — the client counterpart to
/// `src/lib/push/send-apns-push.ts` + `POST /api/push/native/register` on the
/// backend.
///
/// FLOW
///   1. `requestAuthorizationAndRegister()` — asks the user, then
///      `UIApplication.registerForRemoteNotifications()` if granted.
///   2. `AppDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
///      fires → we hex-encode the token and POST it to the register endpoint.
///   3. On sign-out or user disable → `unregister()` DELETEs the row and
///      calls `UIApplication.unregisterForRemoteNotifications()` locally.
///
/// DESIGN
///   - Every dependency (notification center, application, network) is
///     protocol-injected so tests never trigger a real permission prompt or
///     hit the network. Production init uses live objects; test init uses
///     mocks. Same pattern as `BiometricGate`.
///   - Errors are typed (`PushRegistrationError`) so the UI can render a
///     specific next step instead of a generic "failed."
///   - Uses `os.Logger` (subsystem = bundle id) so a Console.app filter picks
///     up all push-related lines cleanly during device debugging.
public enum PushAuthorizationStatus: Equatable {
    case notDetermined
    case denied
    case authorized
    case provisional     // silently delivers to Notification Center only
    case ephemeral       // App Clips only; not applicable here but exhaustive
}

public enum PushRegistrationError: Error, Equatable {
    case authorizationDenied
    case registrationFailed(String)
    case backendRejected(status: Int, body: String?)
    case network(String)
    case notSignedIn
}

// MARK: - Injection seams

public protocol NotificationAuthorizer {
    func authorizationStatus() async -> UNAuthorizationStatus
    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
}

public protocol RemoteNotificationRegistrar {
    func registerForRemoteNotifications()
    func unregisterForRemoteNotifications()
}

public protocol BackendRegistering {
    /// POST /api/push/native/register with the payload the server validates.
    func register(deviceTokenHex: String, bundleId: String, environment: String) async throws
    /// DELETE /api/push/native/register — unregister on sign-out / opt-out.
    func unregister(deviceTokenHex: String) async throws
}

// MARK: - Production adapters

/// Adapter over `UNUserNotificationCenter.current()`. Kept small on purpose —
/// the surface is exactly what the service needs, no more.
public struct UserNotificationCenterAuthorizer: NotificationAuthorizer {
    public init() {}
    public func authorizationStatus() async -> UNAuthorizationStatus {
        await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings.authorizationStatus)
            }
        }
    }
    public func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: options)
    }
}

/// Adapter over `UIApplication.shared`. `MainActor` because
/// `registerForRemoteNotifications` requires the main thread per Apple docs.
@MainActor
public struct UIApplicationRegistrar: RemoteNotificationRegistrar {
    public init() {}
    public func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
    }
    public func unregisterForRemoteNotifications() {
        UIApplication.shared.unregisterForRemoteNotifications()
    }
}

/// Real backend caller — POSTs JSON to the register/unregister endpoints on
/// `AppConfig.backendURL`. Uses `URLSession.shared` so the OS cookie store
/// carries the Clerk `__session` cookie set by an earlier authenticated web
/// flow (the same auth model the Capacitor shell uses today — the native app
/// bridges through it until Sign in with Apple ships).
public struct URLSessionBackendRegistrar: BackendRegistering {
    private let session: URLSession
    public init(session: URLSession = .shared) { self.session = session }

    public func register(deviceTokenHex: String, bundleId: String, environment: String) async throws {
        try await call(
            method: "POST",
            path: "/api/push/native/register",
            body: [
                "deviceToken": deviceTokenHex,
                "bundleId": bundleId,
                "environment": environment,
                "platform": "ios",
            ]
        )
    }

    public func unregister(deviceTokenHex: String) async throws {
        try await call(
            method: "DELETE",
            path: "/api/push/native/register",
            body: ["deviceToken": deviceTokenHex]
        )
    }

    private func call(method: String, path: String, body: [String: String]) async throws {
        var request = URLRequest(url: AppConfig.backendURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("BlackOutNative/\(AppConfig.appVersion)", forHTTPHeaderField: "user-agent")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw PushRegistrationError.network("no HTTPURLResponse")
        }
        // 401 (not signed in) is a distinct actionable state — Account UI can
        // deep-link the user to sign in, then retry. Other 4xx/5xx bubble up
        // with the body so the log has real diagnostic value.
        if http.statusCode == 401 { throw PushRegistrationError.notSignedIn }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8)?.prefix(300).description
            throw PushRegistrationError.backendRejected(status: http.statusCode, body: body)
        }
    }
}

// MARK: - Service

/// Stateless service — safe to instantiate on demand. Session state (the
/// current device token) is owned by the AppDelegate lifecycle, not this
/// service, so a `PushRegistrationService` doesn't need cache invalidation.
public struct PushRegistrationService {
    private let authorizer: NotificationAuthorizer
    private let registrar: RemoteNotificationRegistrar
    private let backend: BackendRegistering
    private let logger = Logger(subsystem: "com.blackout-trades.app", category: "push")

    public init(
        authorizer: NotificationAuthorizer,
        registrar: RemoteNotificationRegistrar,
        backend: BackendRegistering
    ) {
        self.authorizer = authorizer
        self.registrar = registrar
        self.backend = backend
    }

    /// Convenience init using the production adapters.
    @MainActor
    public static func live() -> PushRegistrationService {
        PushRegistrationService(
            authorizer: UserNotificationCenterAuthorizer(),
            registrar: UIApplicationRegistrar(),
            backend: URLSessionBackendRegistrar()
        )
    }

    /// Current permission state, translated to our internal enum.
    public func status() async -> PushAuthorizationStatus {
        Self.map(await authorizer.authorizationStatus())
    }

    /// Ask, then (on grant) tell iOS to register with APNs. The APNs token is
    /// delivered asynchronously to the AppDelegate; call `registerToken()`
    /// from there.
    @discardableResult
    public func requestAuthorizationAndRegister() async throws -> PushAuthorizationStatus {
        // `.alert, .sound, .badge` covers the standard product surface;
        // deliberately omitting `.criticalAlert` (requires an Apple-granted
        // entitlement) and `.provisional` (silent delivery hides alerts from
        // the user during a review demo — we want prompts to be explicit).
        let granted = try await authorizer.requestAuthorization(options: [.alert, .sound, .badge])
        if !granted {
            logger.info("push permission denied by user")
            throw PushRegistrationError.authorizationDenied
        }
        // Must be called on the main thread per UIKit contract — the
        // registrar type is `@MainActor` and this whole call is dispatched
        // there by the concurrency system.
        await MainActor.run { registrar.registerForRemoteNotifications() }
        return Self.map(await authorizer.authorizationStatus())
    }

    /// Called from AppDelegate once the OS hands us the raw APNs device token.
    /// Hex-encodes and POSTs to the backend.
    public func registerToken(_ tokenData: Data) async {
        let hex = tokenData.map { String(format: "%02x", $0) }.joined()
        do {
            try await backend.register(
                deviceTokenHex: hex,
                bundleId: AppConfig.bundleIdentifier,
                environment: AppConfig.apnsEnvironment
            )
            logger.info("APNs token registered with backend (len \(hex.count))")
        } catch let err as PushRegistrationError {
            logger.error("APNs backend register failed: \(String(describing: err))")
        } catch {
            logger.error("APNs backend register threw: \(error.localizedDescription)")
        }
    }

    /// User signed out or turned notifications off — unregister the specific
    /// token AND ask iOS to stop remote-notification delivery locally.
    public func unregister(tokenData: Data?) async {
        if let tokenData {
            let hex = tokenData.map { String(format: "%02x", $0) }.joined()
            do {
                try await backend.unregister(deviceTokenHex: hex)
                logger.info("APNs token unregistered from backend")
            } catch {
                // Best-effort — a network failure here shouldn't block the
                // local unregister. The 410 prune on the server catches the
                // stale token on the next push attempt anyway.
                logger.error("APNs backend unregister failed: \(error.localizedDescription)")
            }
        }
        await MainActor.run { registrar.unregisterForRemoteNotifications() }
    }

    /// Called from AppDelegate when APNs registration itself fails on the
    /// device (e.g. no APNs entitlement in the current provisioning profile,
    /// airplane mode). Kept separate from `registerToken` so tests can
    /// exercise the sad path.
    public func handleRegistrationFailure(_ error: Error) {
        logger.error("APNs device registration failed: \(error.localizedDescription)")
    }

    private static func map(_ status: UNAuthorizationStatus) -> PushAuthorizationStatus {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied:        return .denied
        case .authorized:    return .authorized
        case .provisional:   return .provisional
        case .ephemeral:     return .ephemeral
        @unknown default:    return .notDetermined
        }
    }
}
