import Foundation
import LocalAuthentication

/// Face ID / Touch ID / device-passcode gate for the app.
///
/// Design principles (per the master prompt's Section 12 requirements):
/// - Biometric authentication is a **local gate on top of** server-side
///   authentication, NEVER a replacement. A successful Face ID unlock unlocks
///   the LOCAL app UI; the server still enforces the session/entitlement.
/// - Every failure mode is a first-class case (`BiometricUnlockError`), not a
///   thrown NSError. The Account settings screen renders per-case UI so a
///   locked-out user gets a clear next step (passcode fallback, disable, help).
/// - Fully protocol-driven so tests can inject a fake evaluator. The default
///   `LAContextEvaluator` wraps `LAContext` and is only referenced at the app
///   composition root (`BlackOutApp`).
///
/// UI wiring lands in the Account settings screen next (task N-1 second half);
/// this file is the service layer.
public enum BiometricAvailability: Equatable {
    /// Face ID / Touch ID is enrolled and ready to prompt.
    case available(kind: BiometricKind)
    /// The device supports biometrics but nothing is enrolled.
    case notEnrolled
    /// The user disabled biometrics or denied permission.
    case denied
    /// The device has no biometric hardware.
    case notAvailable
    /// A rare error class (kernel-level) — treat as "not available" in UI.
    case unknown(message: String)
}

public enum BiometricKind: String, Equatable {
    case faceID
    case touchID
    case opticID // Vision Pro; harmless to include, keeps the enum future-proof.
    case none
}

public enum BiometricUnlockError: Error, Equatable {
    case userCancelled
    case userFallback // user chose "Use Passcode"
    case authenticationFailed
    case biometryLockout // too many failed attempts — passcode required to re-enable
    case notAvailable
    case appCancel // system cancelled (backgrounded, another prompt won)
    case systemCancel
    case unknown(String)
}

/// Protocol seam over `LAContext` so tests never touch the real system prompt.
public protocol LAEvaluating {
    func canEvaluatePolicy(_ policy: LAPolicy) -> (Bool, Error?)
    func evaluatePolicy(_ policy: LAPolicy, reason: String) async throws -> Bool
    var biometryType: LABiometryType { get }
}

public struct LAContextEvaluator: LAEvaluating {
    private let context: LAContext

    public init(context: LAContext = LAContext()) {
        self.context = context
        // Localized "cancel/fallback" button copy — set here rather than in the
        // call site so the whole app agrees on wording.
        self.context.localizedFallbackTitle = "Use Passcode"
        self.context.localizedCancelTitle = "Cancel"
    }

    public func canEvaluatePolicy(_ policy: LAPolicy) -> (Bool, Error?) {
        var err: NSError?
        let ok = context.canEvaluatePolicy(policy, error: &err)
        return (ok, err)
    }

    public func evaluatePolicy(_ policy: LAPolicy, reason: String) async throws -> Bool {
        try await context.evaluatePolicy(policy, localizedReason: reason)
    }

    public var biometryType: LABiometryType { context.biometryType }
}

/// The service. Stateless — safe to construct per call.
public struct BiometricGate {
    private let make: () -> LAEvaluating

    /// Default init uses a fresh `LAContext` per attempt (required — `LAContext`
    /// caches the auth result within its lifetime; re-using it means a second
    /// unlock silently succeeds without prompting the user).
    public init(evaluatorFactory: @escaping () -> LAEvaluating = { LAContextEvaluator() }) {
        self.make = evaluatorFactory
    }

    /// Reports what the device+user setup allows right now.
    /// Cheap to call — safe to bind to Settings screen refresh.
    public func availability() -> BiometricAvailability {
        let ev = make()
        let (ok, err) = ev.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)
        let kind = map(biometryType: ev.biometryType)
        if ok { return .available(kind: kind) }
        guard let laError = err as? LAError else {
            return .unknown(message: err?.localizedDescription ?? "unknown")
        }
        switch laError.code {
        case .biometryNotEnrolled: return .notEnrolled
        case .biometryNotAvailable: return .notAvailable
        case .userFallback, .userCancel, .appCancel, .systemCancel:
            return .denied
        default:
            return .unknown(message: laError.localizedDescription)
        }
    }

    /// Prompt for unlock. Returns true on success; throws a typed error otherwise.
    /// `reason` is shown in the system prompt — keep it a specific, honest
    /// sentence ("Unlock the BlackOut desk") not a marketing line.
    public func unlock(reason: String) async throws -> Bool {
        let ev = make()
        do {
            return try await ev.evaluatePolicy(.deviceOwnerAuthentication, reason: reason)
            // NOTE — we use `.deviceOwnerAuthentication` (bio + passcode
            // fallback), not `.deviceOwnerAuthenticationWithBiometrics` (bio
            // only), so a bio-locked-out user can still unlock with passcode
            // rather than being wall-locked out of the app.
        } catch let error as LAError {
            throw Self.map(error)
        } catch {
            throw BiometricUnlockError.unknown(error.localizedDescription)
        }
    }

    private func map(biometryType: LABiometryType) -> BiometricKind {
        switch biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        case .none: return .none
        @unknown default: return .none
        }
    }

    static func map(_ error: LAError) -> BiometricUnlockError {
        switch error.code {
        case .userCancel: return .userCancelled
        case .userFallback: return .userFallback
        case .authenticationFailed: return .authenticationFailed
        case .biometryLockout: return .biometryLockout
        case .biometryNotAvailable, .biometryNotEnrolled: return .notAvailable
        case .appCancel: return .appCancel
        case .systemCancel: return .systemCancel
        default: return .unknown(error.localizedDescription)
        }
    }
}
