import Foundation
import Combine

/// Ticker-detail sheet state. Same shape as CommandViewModel / SignalsViewModel
/// — .idle / .loading / .loaded / .error, preserve-on-error, single fetch on
/// sheet-present + one manual refresh via pull-to-refresh.
///
/// Unlike the tab viewmodels, this one is short-lived (sheet lifetime, not
/// tab lifetime) so it does NOT auto-refresh. Data doesn't move fast enough
/// on a positioning read for a poll interval inside a modal to be worth the
/// extra request budget — pull-to-refresh is the escape hatch.
@MainActor
public final class TickerDetailViewModel: ObservableObject {
    public enum LoadState: Equatable {
        case idle
        case loading
        case loaded(detail: TickerDetail, fetchedAt: Date)
        case error(message: String)
    }

    @Published public private(set) var state: LoadState = .idle
    public let ticker: String

    private let repo: TickerDetailRepository

    public init(ticker: String, repo: TickerDetailRepository = LiveTickerDetailRepository()) {
        self.ticker = ticker
        self.repo = repo
    }

    public func refresh() async {
        let prev = state.detail
        if state == .idle { state = .loading }
        do {
            let d = try await repo.fetch(ticker)
            state = .loaded(detail: d, fetchedAt: Date())
        } catch let err as APIError {
            state = mapError(err, previous: prev)
        } catch {
            state = mapError(.network(error.localizedDescription), previous: prev)
        }
    }

    private func mapError(_ err: APIError, previous: TickerDetail?) -> LoadState {
        if let p = previous {
            return .loaded(detail: p, fetchedAt: (state.fetchedAtOrNil() ?? Date()))
        }
        switch err {
        case .invalidURL:      return .error(message: "Invalid ticker URL.")
        case .network(let m):  return .error(message: "Network is unavailable. \(m)")
        case .notAuthorized:   return .error(message: "Sign in to see ticker positioning.")
        case .forbidden:       return .error(message: "Ticker positioning requires Premium.")
        case .notFound:        return .error(message: "No positioning for this ticker yet.")
        case .rateLimited(let r):
            return .error(message: r.map { "Too many requests. Retrying in \($0)s." } ?? "Too many requests.")
        case .serverError(let s, _): return .error(message: "Positioning source is down (HTTP \(s)).")
        case .decodingFailed:  return .error(message: "The positioning format changed. Please update the app.")
        case .timeout:         return .error(message: "Positioning didn't respond in time.")
        case .cancelled:       return .error(message: "Cancelled.")
        }
    }
}

extension TickerDetailViewModel.LoadState {
    var detail: TickerDetail? {
        if case .loaded(let d, _) = self { return d }
        return nil
    }
    func fetchedAtOrNil() -> Date? {
        if case .loaded(_, let at) = self { return at }
        return nil
    }
}
