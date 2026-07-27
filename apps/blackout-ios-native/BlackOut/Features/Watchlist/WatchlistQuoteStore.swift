import Foundation
import Combine

/// A per-ticker live quote cache shared across every Watchlist row.
///
/// The reason this exists instead of one `@StateObject` per row: SwiftUI
/// rebuilds `List` children aggressively (edit mode, reorder, add/remove),
/// which resets per-row StateObjects and cancels their `.task` — every
/// mutation would blank every price. Owning the cache one level up keeps
/// the fetches independent of row lifetime.
///
/// Fetch strategy: one refresh per ticker per `interval` (default 5s),
/// launched from `startAutoRefresh(for:)`. Cancelled via
/// `stopAutoRefresh(for:)` or automatically when the store is deallocated.
/// Preserve-on-error — a transient network blip keeps the last known price
/// visible; the UI reads staleness off the `asof` timestamp.
@MainActor
public final class WatchlistQuoteStore: ObservableObject {
    @Published public private(set) var quotes: [String: TickerQuote] = [:]

    private let repo: QuoteRepository
    private var tasks: [String: Task<Void, Never>] = [:]

    public init(repo: QuoteRepository = LiveQuoteRepository()) { self.repo = repo }

    deinit {
        for (_, t) in tasks { t.cancel() }
    }

    /// Start (or replace) the refresh task for a ticker. Idempotent —
    /// calling twice for the same ticker cancels the previous loop and
    /// starts a fresh one.
    public func startAutoRefresh(for ticker: String, intervalSeconds: UInt64 = 5) {
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

    /// Reconcile the set of running fetch loops with the current watchlist:
    /// start loops for tickers that are new, stop loops for tickers that
    /// were removed. Call whenever the watchlist changes so old fetches
    /// stop wasting cycles on removed tickers.
    public func syncTo(watchlist: [String]) {
        let want = Set(watchlist)
        let running = Set(tasks.keys)
        for gone in running.subtracting(want) { stopAutoRefresh(for: gone) }
        for adding in want.subtracting(running) { startAutoRefresh(for: adding) }
    }

    /// One-shot fetch — used by the loop above and by manual pull-to-refresh
    /// if wired later.
    public func refresh(_ ticker: String) async {
        do {
            let q = try await repo.fetch(ticker)
            quotes[ticker] = q
        } catch {
            // Preserve-on-error: leave the previous quote in place so the row
            // doesn't blank during a transient timeout. Staleness is visible
            // via the `asof` timestamp in the UI.
        }
    }
}
