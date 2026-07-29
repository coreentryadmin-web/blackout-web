import Foundation
import Security

/// Minimal Security.framework wrapper for storing the Clerk `__session` token.
///
/// Deliberately tiny: one item per key, generic-password class, first-unlock
/// accessibility so the token is available once the device has been unlocked
/// after boot (Face ID gate still applies at the app level via `AppLockCoordinator`).
///
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` picked over `.WhenUnlocked`:
///   - "AfterFirstUnlock" — token stays available while the app is
///     backgrounded, so we don't get spurious sign-outs on a re-launch that
///     races the passcode screen.
///   - "ThisDeviceOnly" — never migrates via iCloud Keychain backup. A
///     restored device requires a fresh sign-in, which is the correct
///     posture for a session credential.
public enum KeychainStore {
    public enum KeychainError: Error {
        case unexpectedStatus(OSStatus)
    }

    public static func save(_ data: Data, for key: String) throws {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        // Delete first so `SecItemAdd` never runs against an existing item
        // (would return `errSecDuplicateItem`); simpler than the
        // add-else-update dance and identical behaviour.
        SecItemDelete(base as CFDictionary)

        var attrs = base
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    public static func read(for key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { return nil }
        return data
    }

    public static func delete(for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        // errSecItemNotFound is fine — deleting a non-existent item is a no-op.
        SecItemDelete(query as CFDictionary)
    }
}
