import Foundation
import Combine

@MainActor
public final class WatchlistQuoteStore: ObservableObject {
    @Published public private(set) var quotes: [String: TickerQuote] = [:]

    private let repo: QuoteRepository
    private var tasks: [String: Task<Void, Never>] = [:]

    public init(repo: QuoteRepository = LiveQuoteRepository()) { self.repo = repo }

    deinit {
        for (_, t) in tasks { t.cancel() }
    }

    public func startAutoRefresh(for ticker: String, intervalSeconds: UInt64 = 8) {
        stopAutoRefresh(for: ticker)
        tasks[ticker] = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh(ticker)
                do {
                    try await Task.sleep(nanoseconds: intervalSeconds * 1_000_000_000)
                } catch { return }
            }
        }
    }

    public func stopAutoRefresh(for ticker: String) {
        tasks[ticker]?.cancel()
        tasks[ticker] = nil
    }

    public func syncTo(watchlist: [String]) {
        let want = Set(watchlist)
        let running = Set(tasks.keys)
        for gone in running.subtracting(want) { stopAutoRefresh(for: gone) }
        for adding in want.subtracting(running) { startAutoRefresh(for: adding) }
    }

    public func refresh(_ ticker: String) async {
        do {
            quotes[ticker] = try await repo.fetch(ticker)
        } catch {
            // Preserve-on-error — last quote stays visible.
        }
    }
}
