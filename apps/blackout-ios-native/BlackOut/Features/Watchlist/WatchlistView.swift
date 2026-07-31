import SwiftUI

/// WATCHLIST — personalized tickers, alerts, saved levels. Tab 4 of the IA.
///
/// v1 ships the ticker CRUD (add / remove / reorder) with local persistence.
/// Alerts + per-ticker detail land next; the store already exists so this
/// won't change shape when the server sync arrives.
struct WatchlistView: View {
    // Shared across the app so the tab bar can badge future ticker counts
    // and other screens (Command pulse, Signals filter) can read the same
    // list — one source of truth. Provided by BlackOutApp with the sync
    // service attached; SwiftUI previews can inject a plain WatchlistStore
    // via .environmentObject.
    @EnvironmentObject private var store: WatchlistStore
    @StateObject private var quotes = WatchlistQuoteStore()
    @State private var showingAdd = false
    // Tapping a row presents the detail sheet. Kept as an optional binding
    // so `sheet(item:)` handles present/dismiss consistently — a bool +
    // separate "which ticker" state would race on quick taps.
    @State private var detailTicker: TickerSelection?

    var body: some View {
        Group {
            if store.tickers.isEmpty {
                BOEmptyState(
                    systemImage: "star",
                    title: "Your watchlist is empty",
                    message: "Add tickers to get per-symbol alerts and to filter Helix flow, Thermal, and Signals to your list.",
                    actionTitle: "Add a ticker",
                    action: { showingAdd = true }
                )
                .padding(BOSpacing.comfortable)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(BOColor.backgroundBase.ignoresSafeArea())
                .navigationTitle("Watchlist")
                .navigationBarTitleDisplayMode(.large)
                .toolbar { toolbarItems }
            } else {
                List {
                    Section {
                        ForEach(store.tickers, id: \.self) { t in
                            Button {
                                detailTicker = TickerSelection(ticker: t)
                            } label: {
                                WatchlistRow(ticker: t, quote: quotes.quotes[t])
                            }
                            .buttonStyle(.plain)
                            .frame(minHeight: BOTouchTarget.minimum)
                            .listRowBackground(BOColor.backgroundCard)
                        }
                        .onDelete { indexSet in
                            for i in indexSet.sorted(by: >) {
                                let t = store.tickers[i]
                                store.remove(t)
                            }
                        }
                        .onMove { source, destination in
                            store.move(from: source, to: destination)
                        }
                    } header: {
                        BOSectionLabel("Tickers · \(store.tickers.count)")
                    } footer: {
                        Text("Swipe left to remove. Edit to reorder. Tap Add to append.")
                            .font(BOFont.caption)
                            .foregroundStyle(BOColor.textCaption)
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(BOColor.backgroundBase.ignoresSafeArea())
                .navigationTitle("Watchlist")
                .navigationBarTitleDisplayMode(.large)
                .toolbar { toolbarItems }
            }
        }
        // Keep the per-ticker fetch loops in sync with the current
        // watchlist — starts new tickers, cancels removed ones.
        .task(id: store.tickers) { quotes.syncTo(watchlist: store.tickers) }
        .sheet(isPresented: $showingAdd) {
            AddTickerSheet { input in
                _ = store.add(input)
                showingAdd = false
            } cancel: {
                showingAdd = false
            }
            .presentationDetents([.medium])
        }
        .sheet(item: $detailTicker) { sel in
            TickerDetailSheet(ticker: sel.ticker)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    @ToolbarContentBuilder
    private var toolbarItems: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            Button {
                showingAdd = true
            } label: {
                Image(systemName: "plus")
                    .foregroundStyle(BOColor.textAccent)
            }
            .accessibilityLabel("Add ticker")
        }
        if !store.tickers.isEmpty {
            ToolbarItem(placement: .navigationBarLeading) {
                EditButton().tint(BOColor.textAccent)
            }
        }
    }
}

/// Wrapper struct so the row-tap sheet can use `sheet(item:)` instead of
/// coupling a bool + optional ticker — avoids stale-state races when a user
/// taps two rows in quick succession.
private struct TickerSelection: Identifiable, Equatable {
    let ticker: String
    var id: String { ticker }
}

private struct AddTickerSheet: View {
    let confirm: (String) -> Void
    let cancel: () -> Void
    @State private var input: String = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: BOSpacing.comfortable) {
                Text("Enter a ticker symbol.")
                    .font(BOFont.body)
                    .foregroundStyle(BOColor.textSecondary)
                TextField("SPX, SPY, NVDA…", text: $input)
                    .textFieldStyle(.plain)
                    .font(BOFont.numericHeading)
                    .foregroundStyle(BOColor.textPrimary)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled(true)
                    .submitLabel(.done)
                    .focused($focused)
                    .padding(BOSpacing.comfortable)
                    .background(
                        RoundedRectangle(cornerRadius: BORadius.control, style: .continuous)
                            .fill(BOColor.backgroundCard)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: BORadius.control, style: .continuous)
                            .strokeBorder(BOColor.border, lineWidth: 1)
                    )
                    .onSubmit { if isValid { confirm(input) } }

                if !input.isEmpty && !isValid {
                    Text("Tickers are 1–8 letters or digits, optionally with a single dot (BRK.B).")
                        .font(BOFont.caption)
                        .foregroundStyle(BOColor.statusCaution)
                }
                Spacer()
            }
            .padding(BOSpacing.comfortable)
            .background(BOColor.backgroundBase.ignoresSafeArea())
            .navigationTitle("Add ticker")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel", action: cancel).tint(BOColor.textCaption)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Add") { confirm(input) }
                        .disabled(!isValid)
                        .tint(BOColor.textAccent)
                        .fontWeight(.semibold)
                }
            }
            .onAppear { focused = true }
        }
    }

    private var isValid: Bool { WatchlistStore.normalize(input) != nil }
}
