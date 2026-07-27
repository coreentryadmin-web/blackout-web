import Foundation
import Combine

/// Viewmodel behind the Command-tab "Active opportunities" card.
///
/// Owns its own SignalsRepository fetch — deliberately independent from
/// `SignalsViewModel` so the Command tab renders even if a member never
/// visits the Signals tab in this session. The extra 30s poll is cheap
/// (`/api/mobile/signals` is a small no-store JSON) and the isolation
/// keeps the two viewmodels replaceable without cross-effects.
///
/// Same preserve-on-error policy as the rest of Command — a transient
/// timeout keeps the last-known opportunities visible with the freshness
/// carrying the age, not a blank card.
@MainActor
public final class ActiveOpportunitiesViewModel: ObservableObject {
    public enum LoadState: Equatable {
        case idle
        case loading
        case loaded(feed: SignalsFeed, fetchedAt: Date)
        case error(message: String)
    }

    @Published public private(set) var state: LoadState = .idle

    private let repo: SignalsRepository

    public init(repo: SignalsRepository = LiveSignalsRepository()) { self.repo = repo }

    /// The top opportunities to surface on Command. Rules:
    ///  - Only actionable stages: active, managing, confirming (never
    ///    detected/graded/invalidated on the summary card; the whole
    ///    Signals tab is one tap away).
    ///  - Ordered by score (highest first); the feed itself is
    ///    lifecycle-sorted, but the summary card is a "top N by merit".
    ///  - Deduped by ticker — one row per ticker so a member never sees
    ///    "NVDA / NVDA / NVDA" on the summary when two engines both flag
    ///    the same name. Winner is the higher-scoring row.
    public func topOpportunities(limit: Int = 3) -> [Signal] {
        guard case .loaded(let feed, _) = state else { return [] }
        let actionable: Set<SignalLifecycle> = [.active, .managing, .confirming]
        let byTicker = Dictionary(grouping: feed.signals.filter { actionable.contains($0.phase) }) { $0.ticker }
        let picked: [Signal] = byTicker.values.compactMap { rows in
            rows.max { ($0.score ?? -1) < ($1.score ?? -1) }
        }
        return picked
            .sorted { ($0.score ?? -1) > ($1.score ?? -1) }
            .prefix(limit)
            .map { $0 }
    }

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
        if let p = previous { return .loaded(feed: p, fetchedAt: (state.fetchedAtOrNil() ?? Date())) }
        let msg: String
        switch err {
        case .invalidURL:            msg = "The opportunities URL is invalid."
        case .network(let m):        msg = "Network is unavailable. \(m)"
        case .notAuthorized:         msg = "Sign in to see live opportunities."
        case .forbidden:             msg = "Live opportunities are part of Premium."
        case .notFound:              msg = "The opportunities feed moved. Please update the app."
        case .rateLimited(let r):
            if let r { msg = "Too many requests. Retrying in \(r)s." }
            else     { msg = "Too many requests. Retrying shortly." }
        case .serverError(let s, _): msg = "The opportunities feed is down (HTTP \(s))."
        case .decodingFailed:        msg = "The opportunities format changed. Please update the app."
        case .timeout:               msg = "The opportunities feed didn't respond in time."
        case .cancelled:             msg = "Cancelled."
        }
        return .error(message: msg)
    }
}

extension ActiveOpportunitiesViewModel.LoadState {
    var feed: SignalsFeed? {
        if case .loaded(let f, _) = self { return f }
        return nil
    }
    func fetchedAtOrNil() -> Date? {
        if case .loaded(_, let at) = self { return at }
        return nil
    }
}
