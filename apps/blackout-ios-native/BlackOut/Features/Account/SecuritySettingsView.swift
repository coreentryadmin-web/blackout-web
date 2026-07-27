import SwiftUI

/// Security settings — Face ID app-lock toggle + status. Reached from the
/// Account tab. Real toggle (not a placeholder) so this is the first
/// user-facing native feature that actually DOES something in the app.
public struct SecuritySettingsView: View {
    @EnvironmentObject var appLock: AppLockCoordinator
    @State private var toggle: Bool = false
    @State private var availability: BiometricAvailability = .notAvailable
    @State private var pending: Bool = false

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BOSpacing.block) {
                intro
                lockCard
                availabilityCard
            }
            .padding(BOSpacing.comfortable)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.large)
        .task {
            availability = BiometricGate().availability()
            toggle = appLock.isEnabled
        }
    }

    private var intro: some View {
        Text("Require Face ID whenever BlackOut returns to the foreground. Your session with the server is unchanged — this only gates the app UI on your device.")
            .font(BOFont.body)
            .foregroundStyle(BOColor.textSecondary)
    }

    private var lockCard: some View {
        VStack(alignment: .leading, spacing: BOSpacing.snug) {
            HStack(alignment: .center, spacing: BOSpacing.comfortable) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("App lock").font(BOFont.bodyBold).foregroundStyle(BOColor.textPrimary)
                    Text(subtitle).font(BOFont.caption).foregroundStyle(BOColor.textCaption)
                }
                Spacer(minLength: BOSpacing.snug)
                Toggle("App lock", isOn: $toggle)
                    .labelsHidden()
                    .disabled(pending || !isTogglable)
                    .tint(BOColor.textAccent)
                    .onChange(of: toggle) { _, newValue in
                        Task { await commit(newValue) }
                    }
            }
            if let err = appLock.lastError, toggle {
                Text(errorMessage(for: err))
                    .font(BOFont.caption)
                    .foregroundStyle(BOColor.statusCaution)
            }
        }
        .padding(BOSpacing.comfortable)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                .fill(BOColor.backgroundCard)
        )
        .overlay(
            RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                .strokeBorder(BOColor.border, lineWidth: 1)
        )
    }

    private var availabilityCard: some View {
        VStack(alignment: .leading, spacing: BOSpacing.hairline) {
            Text("Status").font(BOFont.label).textCase(.uppercase).tracking(1.4)
                .foregroundStyle(BOColor.textCaption)
            Text(statusText)
                .font(BOFont.body)
                .foregroundStyle(BOColor.textPrimary)
        }
        .padding(BOSpacing.comfortable)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                .fill(BOColor.backgroundCard)
        )
        .overlay(
            RoundedRectangle(cornerRadius: BORadius.card, style: .continuous)
                .strokeBorder(BOColor.border, lineWidth: 1)
        )
    }

    private var subtitle: String {
        switch availability {
        case .available(.faceID):  return "Uses Face ID + your device passcode as backup."
        case .available(.touchID): return "Uses Touch ID + your device passcode as backup."
        case .available(.opticID): return "Uses Optic ID + your device passcode as backup."
        case .available(.none):    return "Uses your device passcode."
        case .notEnrolled:         return "Set up Face ID or a device passcode in iOS Settings to enable."
        case .denied:              return "BlackOut is blocked from using Face ID in iOS Settings → Face ID & Passcode."
        case .notAvailable:        return "This device doesn't support biometric authentication."
        case .unknown:             return "Biometric status is currently unavailable."
        }
    }

    private var statusText: String {
        switch availability {
        case .available(.faceID):  return "Face ID is enrolled and ready."
        case .available(.touchID): return "Touch ID is enrolled and ready."
        case .available(.opticID): return "Optic ID is enrolled and ready."
        case .available(.none):    return "Device passcode is set and can be used."
        case .notEnrolled:         return "No biometric enrolled. Open iOS Settings → Face ID & Passcode."
        case .denied:              return "BlackOut isn't allowed to use biometrics. Open iOS Settings → BlackOut."
        case .notAvailable:        return "Not supported on this device."
        case .unknown(let msg):    return msg
        }
    }

    private var isTogglable: Bool {
        switch availability {
        case .available: return true
        default:         return false
        }
    }

    private func commit(_ enabled: Bool) async {
        pending = true
        defer { pending = false }
        await appLock.setEnabled(enabled)
        // If enable failed (user cancelled the confirmation prompt) the
        // coordinator kept isEnabled=false; snap the toggle back so the UI
        // reflects reality.
        toggle = appLock.isEnabled
    }

    private func errorMessage(for err: BiometricUnlockError) -> String {
        switch err {
        case .userCancelled:         return "You cancelled the confirmation. App lock is off."
        case .userFallback:          return "Fallback chosen. App lock is off."
        case .authenticationFailed:  return "Face ID didn't match. Try again to enable."
        case .biometryLockout:       return "Face ID is locked. Unlock your device passcode, then retry."
        case .notAvailable:          return "Biometrics aren't available."
        case .appCancel, .systemCancel: return "The prompt was interrupted. Try again."
        case .unknown(let msg):      return msg
        }
    }
}

#Preview("SecuritySettings") {
    NavigationStack {
        SecuritySettingsView()
            .environmentObject(AppLockCoordinator())
    }
    .preferredColorScheme(.dark)
    .tint(BOColor.textAccent)
}
