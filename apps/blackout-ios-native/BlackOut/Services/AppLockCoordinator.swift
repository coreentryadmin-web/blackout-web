import Foundation
import SwiftUI
import Combine

/// Face ID app-lock lifecycle coordinator.
///
/// STATES
///   - `.disabled`  — user hasn't opted in. Nothing happens on background.
///   - `.unlocked`  — enabled + currently trusted. UI is visible.
///   - `.locked`    — enabled + the app returned to foreground and the
///                    trust window has elapsed. UI is covered by a lock
///                    view until Face ID succeeds.
///   - `.prompting` — Face ID prompt is on screen. Prevents a second prompt
///                    from being fired by a re-entrant lifecycle event.
///
/// POLICY
///   - `willResignActive` → snap to `.locked` (cover the screen BEFORE it
///     leaves the foreground so the iOS app switcher only shows the lock UI,
///     not the last frame of the desk).
///   - `didBecomeActive`  → if `.locked`, run Face ID via `BiometricGate`.
///   - Uses `UserDefaults` for the enable/disable flag — user-visible setting,
///     not a secret. If a stricter guarantee is needed later, move to the
///     Keychain (a hostile app on the same device can't read/write `UD`
///     values that another app wrote — the risk here is basically nil).
///
/// This is an @Observable-style class using ObservableObject for iOS 17
/// compatibility while the app is scaffolded (the @Observable macro is
/// iOS 17+; ObservableObject is universal and works fine).
@MainActor
public final class AppLockCoordinator: ObservableObject {

    public enum State: Equatable {
        case disabled
        case unlocked
        case locked
        case prompting
    }

    // MARK: - Public state

    @Published public private(set) var state: State
    @Published public private(set) var lastError: BiometricUnlockError?

    /// User preference — read/write via `setEnabled(_:)` so the state
    /// transition is a single choke point.
    public var isEnabled: Bool { defaults.bool(forKey: Self.enabledKey) }

    // MARK: - Dependencies

    private let gate: BiometricGate
    private let defaults: UserDefaults
    private static let enabledKey = "blackout.applock.enabled"

    public init(gate: BiometricGate = BiometricGate(), defaults: UserDefaults = .standard) {
        self.gate = gate
        self.defaults = defaults
        // Cold start: if the setting is on, we start LOCKED — the user must
        // pass Face ID before seeing anything.
        self.state = defaults.bool(forKey: Self.enabledKey) ? .locked : .disabled
    }

    // MARK: - User controls

    /// Turn app-lock on or off. Enabling immediately requires a Face ID
    /// confirmation so the user proves their bio works BEFORE they're
    /// counting on it. Disabling is instant (no bio required — the user is
    /// already in and can turn things off; requiring bio to disable would
    /// permanently lock a user whose Face ID stopped enrolling).
    public func setEnabled(_ enabled: Bool) async {
        if enabled {
            do {
                _ = try await gate.unlock(reason: "Confirm to enable BlackOut Face ID lock")
                defaults.set(true, forKey: Self.enabledKey)
                state = .unlocked
                lastError = nil
            } catch let err as BiometricUnlockError {
                lastError = err
                // Don't set the flag if the confirmation failed — otherwise
                // we'd claim the feature is on but the user never verified.
            } catch {
                lastError = .unknown(error.localizedDescription)
            }
        } else {
            defaults.set(false, forKey: Self.enabledKey)
            state = .disabled
            lastError = nil
        }
    }

    // MARK: - Lifecycle hooks (wire from ScenePhase in the App)

    /// Call when the app is about to leave the foreground (background/inactive).
    /// Idempotent — safe to call from every ScenePhase transition.
    public func applicationWillResignActive() {
        guard isEnabled else { return }
        if state != .prompting { state = .locked }
    }

    /// Call when the app returns to the foreground. Fires the biometric
    /// prompt if the app is locked; no-op otherwise.
    public func applicationDidBecomeActive() async {
        guard isEnabled else { state = .disabled; return }
        if state == .locked {
            await promptToUnlock()
        }
    }

    /// User tapped the "Unlock" button on the lock screen (retry after a
    /// failed Face ID or user-fallback).
    public func retryUnlock() async {
        guard isEnabled, state == .locked else { return }
        await promptToUnlock()
    }

    private func promptToUnlock() async {
        state = .prompting
        do {
            let ok = try await gate.unlock(reason: "Unlock BlackOut")
            if ok {
                state = .unlocked
                lastError = nil
            } else {
                state = .locked
                lastError = .authenticationFailed
            }
        } catch let err as BiometricUnlockError {
            state = .locked
            lastError = err
        } catch {
            state = .locked
            lastError = .unknown(error.localizedDescription)
        }
    }
}

/// The full-screen cover shown when the app is locked. Kept minimal — a
/// centered brand mark + "Unlock" button. The system Face ID prompt is
/// what actually authenticates; this view just prevents peeking.
public struct AppLockOverlay: View {
    @ObservedObject var coordinator: AppLockCoordinator

    public init(coordinator: AppLockCoordinator) {
        self.coordinator = coordinator
    }

    public var body: some View {
        ZStack {
            BOColor.backgroundBase.ignoresSafeArea()
            VStack(spacing: BOSpacing.block) {
                Text("BLACKOUT")
                    .font(BOFont.heading2)
                    .tracking(4)
                    .foregroundStyle(BOColor.textPrimary)
                Text("Locked")
                    .font(BOFont.label)
                    .tracking(1.6)
                    .textCase(.uppercase)
                    .foregroundStyle(BOColor.textCaption)
                if let err = coordinator.lastError {
                    Text(errorMessage(for: err))
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.statusCaution)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, BOSpacing.block)
                }
                Button {
                    Task { await coordinator.retryUnlock() }
                } label: {
                    Text("Unlock")
                        .font(BOFont.bodyBold)
                        .foregroundStyle(BOColor.backgroundBase)
                        .frame(minWidth: 180, minHeight: BOTouchTarget.minimum)
                        .background(
                            RoundedRectangle(cornerRadius: BORadius.control, style: .continuous)
                                .fill(BOColor.textAccent)
                        )
                }
                .padding(.top, BOSpacing.snug)
            }
        }
    }

    private func errorMessage(for err: BiometricUnlockError) -> String {
        switch err {
        case .userCancelled:         return "Cancelled. Tap Unlock to try again."
        case .userFallback:          return "Enter your device passcode to unlock."
        case .authenticationFailed:  return "Face ID didn't match. Tap Unlock to try again."
        case .biometryLockout:       return "Face ID is locked. Enter your device passcode."
        case .notAvailable:          return "Face ID isn't available on this device."
        case .appCancel, .systemCancel: return "Interrupted. Tap Unlock to try again."
        case .unknown(let msg):      return msg
        }
    }
}
