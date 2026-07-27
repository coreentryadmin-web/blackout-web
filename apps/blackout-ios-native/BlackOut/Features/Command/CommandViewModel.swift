import Foundation
import Combine

/// Command tab state. `@MainActor` because every published mutation drives
/// the UI directly; keeps us out of `Task { await MainActor.run { ... } }`
/// boilerplate at the call sites.
///
/// LOADING STATE (per master prompt Section 5 + 17):
///   - `.idle` — never fetched.
///   - `.loading` — first fetch in flight; the UI shows a skeleton, not a spinner.
///   - `.loaded(regime, freshness)` — success; the fetched-at timestamp is
///     shown so no data is ever presented as "live" when it isn't.
///   - `.error(message)` — a specific reason, not "something went wrong."
///
/// REFRESH POLICY: pull-to-refresh in the view + a background 30s polling
/// task while the view is visible. Auto-poll stops when the tab is
/// backgrounded (SwiftUI's `.task` lifecycle handles this — the task is
/// cancelled on disappear).
@MainActor
public final class CommandViewModel: ObservableObject {
    public enum LoadState: Equatable {
        case idle
        case loading
        case loaded(regime: MarketRegime, fetchedAt: Date)
        case error(message: String)
    }

    @Published public private(set) var state: LoadState = .idle
    /// Recent snapshots for the "What changed" timeline card. Newest first.
    /// Populated by `refreshHistory()`. Stays empty on any error so the card
    /// falls back to its skeleton/empty state — never fabricates a change.
    @Published public private(set) var history: [MarketRegime] = []

    private let repo: MarketRegimeRepository

    public init(repo: MarketRegimeRepository = LiveMarketRegimeRepository()) {
        self.repo = repo
    }

    /// One-shot fetch. Preserves the previous loaded value on error so the UI
    /// keeps showing the last-known snapshot with a stale badge, rather than
    /// dropping to an error card.
    public func refresh() async {
        let previousLoaded: MarketRegime? = {
            if case .loaded(let regime, _) = state { return regime }
            return nil
        }()
        if state == .idle { state = .loading }
        do {
            let regime = try await repo.latest()
            state = .loaded(regime: regime, fetchedAt: Date())
        } catch let err as APIError {
            state = mapError(err, previous: previousLoaded)
        } catch {
            state = mapError(.network(error.localizedDescription), previous: previousLoaded)
        }
    }

    /// Continuous refresh — call from `.task` in the view so cancellation on
    /// disappear stops the loop for free. Fires an immediate first fetch of
    /// BOTH the latest snapshot AND the recent history, then polls the
    /// latest every `intervalSeconds`. History is refetched every 4th tick
    /// (default: every 2 min at a 30s cadence) — regime transitions are
    /// slow enough that a fresh history every poll would just be waste.
    public func startAutoRefresh(intervalSeconds: UInt64 = 30) async {
        await refresh()
        await refreshHistory()
        var tick: UInt64 = 0
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: intervalSeconds * 1_000_000_000)
            } catch { return }
            await refresh()
            tick += 1
            if tick % 4 == 0 { await refreshHistory() }
        }
    }

    /// One-shot history fetch. On error, keeps the previous history so a
    /// transient network flap doesn't blank the What-Changed card.
    public func refreshHistory(limit: Int = 16) async {
        do {
            history = try await repo.history(limit: limit)
        } catch {
            // Keep the last known list — the freshness label on the top
            // card already communicates the app's overall stale state.
        }
    }

    private func mapError(_ err: APIError, previous: MarketRegime?) -> LoadState {
        // If we have a previous good snapshot, prefer keeping it visible — the
        // freshness label in the header carries the age, so the user sees the
        // staleness without losing the data.
        if let p = previous {
            return .loaded(regime: p, fetchedAt: (state.fetchedAtOrNil() ?? Date()))
        }
        let msg: String
        switch err {
        case .invalidURL:         msg = "The market data URL is invalid. Please update the app."
        case .network(let m):     msg = "Network is unavailable. \(m)"
        case .notAuthorized:      msg = "You need to sign in to see the desk."
        case .forbidden:          msg = "Your membership doesn't include this data yet."
        case .notFound:           msg = "The market data endpoint moved. Please update the app."
        case .rateLimited(let r):
            if let r { msg = "Too many requests. Retrying in \(r)s." }
            else     { msg = "Too many requests. Retrying shortly." }
        case .serverError(let s, _): msg = "The desk is having a problem (HTTP \(s)). We're on it."
        case .decodingFailed:     msg = "The market data format changed. Please update the app."
        case .timeout:            msg = "The desk didn't respond in time. Pull down to retry."
        case .cancelled:          msg = "Cancelled."
        }
        return .error(message: msg)
    }
}

// MARK: - LoadState conveniences

extension CommandViewModel.LoadState {
    /// Latest regime if we have one, otherwise nil.
    var regime: MarketRegime? {
        if case .loaded(let r, _) = self { return r }
        return nil
    }
    /// Fetched-at (or nil).
    func fetchedAtOrNil() -> Date? {
        if case .loaded(_, let at) = self { return at }
        return nil
    }
}
