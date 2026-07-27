import Foundation
import Combine

/// Watchlist state — local-only v1.
///
/// v2 syncs against a server watchlist (bound to the Clerk user so the same
/// list appears on web + native + notification routing). Until then, this
/// keeps the user's list on-device via UserDefaults so it survives app
/// restarts and the add/remove UX is testable without a backend round-trip.
///
/// Ticker rules (enforced at add time):
///   - 1..8 chars,
///   - letters + digits + one optional `.` (BRK.B),
///   - normalized to uppercase,
///   - deduped (Set semantics, but held as an ordered array so the user's
///     insertion order is preserved in the UI).
@MainActor
public final class WatchlistStore: ObservableObject {
    @Published public private(set) var tickers: [String]

    private let defaults: UserDefaults
    private static let key = "blackout.watchlist.tickers"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.tickers = (defaults.array(forKey: Self.key) as? [String]) ?? []
    }

    /// Add a ticker to the end of the list. Returns the normalized ticker
    /// on success, nil if the input is invalid or already present. Never
    /// throws — caller checks the return value.
    @discardableResult
    public func add(_ raw: String) -> String? {
        guard let t = normalize(raw) else { return nil }
        if tickers.contains(t) { return nil }
        tickers.append(t)
        persist()
        return t
    }

    public func remove(_ ticker: String) {
        guard let t = normalize(ticker) else { return }
        tickers.removeAll { $0 == t }
        persist()
    }

    public func contains(_ raw: String) -> Bool {
        guard let t = normalize(raw) else { return false }
        return tickers.contains(t)
    }

    /// Move within the list (used by SwiftUI `.onMove` when the user is
    /// reordering in edit mode). No-op if indices are out of bounds.
    public func move(from source: IndexSet, to destination: Int) {
        tickers.move(fromOffsets: source, toOffset: destination)
        persist()
    }

    private func persist() {
        defaults.set(tickers, forKey: Self.key)
    }

    /// Normalize + validate. Public + static so views can preview-validate
    /// the "Add ticker" field before enabling the confirm button.
    public static func normalize(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard (1...8).contains(trimmed.count) else { return nil }
        // Allowed chars: A-Z, 0-9, one optional dot (mid, not leading/trailing).
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.")
        guard trimmed.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        if trimmed.hasPrefix(".") || trimmed.hasSuffix(".") { return nil }
        if trimmed.contains("..") { return nil }
        return trimmed
    }

    // Instance wrapper so views can call `store.normalize(...)` too.
    public func normalize(_ raw: String) -> String? { Self.normalize(raw) }
}
