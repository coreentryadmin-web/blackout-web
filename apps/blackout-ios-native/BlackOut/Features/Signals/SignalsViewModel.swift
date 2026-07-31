import Foundation
import Combine

/// Signals tab state. Same shape + preserve-on-error policy as
/// `CommandViewModel` — a transient network flap must not blank the feed,
/// it must keep the last-known signals visible with a stale badge so
/// members don't lose situational awareness mid-session.
@MainActor
public final class SignalsViewModel: ObservableObject {
    public enum LoadState: Equatable {
        case idle
        case loading
        case loaded(feed: SignalsFeed, fetchedAt: Date)
        case error(message: String)
    }

    @Published public private(set) var state: LoadState = .idle

    /// The active filter chip. `nil` = "All". Persisted only in-memory —
    /// intentionally not restored across launches; day-old chip state is
    /// almost always the wrong default when the desk has moved on.
    @Published public var filter: SignalLifecycle?

    private let repo: SignalsRepository

    public init(repo: SignalsRepository = LiveSignalsRepository()) { self.repo = repo }

    /// The signals to render, after the filter is applied. Zero-copy slice
    /// of the loaded feed — computed each access, kept off the state so a
    /// filter change doesn't force a state transition (and thus a skeleton
    /// flash).
    public var visibleSignals: [Signal] {
        guard let feed = state.feed else { return [] }
        guard let filter else { return feed.signals }
        return feed.signals.filter { $0.phase == filter }
    }

    /// Source stats for the header ("SPX Slayer live / Night Hawk 5 plays").
    public var sources: SignalsFeed.Sources? { state.feed?.sources }

    public func refresh() async {
        let previous = state.feed
        if state == .idle { state = .loading }
        do {
            let feed = try await repo.fetch()
            state = .loaded(feed: feed, fetchedAt: Date())
        } catch let err as APIError {
            state = mapError(err, previous: previous)
        } catch {
            state = mapError(.network(error.localizedDescription), previous: previous)
        }
    }

    /// Background auto-refresh loop — call from `.task` in the view so
    /// cancellation on disappear stops it for free. 30s cadence matches
    /// the SPX play/regime endpoints so the whole app updates in step.
    public func startAutoRefresh(intervalSeconds: UInt64 = 30) async {
        await refresh()
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: intervalSeconds * 1_000_000_000)
            } catch { return }
            await refresh()
        }
    }

    private func mapError(_ err: APIError, previous: SignalsFeed?) -> LoadState {
        // Keep the last-known signals visible when possible — the freshness
        // chip in the header carries the staleness, so members see age
        // instead of losing the feed to a transient blip.
        if let p = previous {
            return .loaded(feed: p, fetchedAt: (state.fetchedAtOrNil() ?? Date()))
        }
        let msg: String
        switch err {
        case .invalidURL:            msg = "The signals URL is invalid. Please update the app."
        case .network(let m):        msg = "Network is unavailable. \(m)"
        case .notAuthorized:         msg = "You need to sign in to see signals."
        case .forbidden:             msg = "Signals are part of Premium — upgrade to unlock."
        case .notFound:              msg = "The signals endpoint moved. Please update the app."
        case .rateLimited(let r):
            if let r { msg = "Too many requests. Retrying in \(r)s." }
            else     { msg = "Too many requests. Retrying shortly." }
        case .serverError(let s, _): msg = "The signals desk is having a problem (HTTP \(s))."
        case .decodingFailed:        msg = "The signals format changed. Please update the app."
        case .timeout:               msg = "The signals desk didn't respond in time. Pull down to retry."
        case .cancelled:             msg = "Cancelled."
        }
        return .error(message: msg)
    }
}

extension SignalsViewModel.LoadState {
    var feed: SignalsFeed? {
        if case .loaded(let f, _) = self { return f }
        return nil
    }
    func fetchedAtOrNil() -> Date? {
        if case .loaded(_, let at) = self { return at }
        return nil
    }
}
