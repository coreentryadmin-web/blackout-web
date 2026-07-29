import SwiftUI

/// ACCOUNT — subscription, notifications, security, education, support, legal,
/// and data status. Tab 5 of the IA.
///
/// This is the FIRST tab to move off the placeholder scaffold: it hosts the
/// Face ID app-lock toggle (a real, working native feature) and the future
/// notifications / support / privacy destinations. Everything else is a live
/// row that navigates to a subview — placeholder or real — so the tab reads
/// like a finished settings screen from day one.
struct AccountView: View {
    @EnvironmentObject var appLock: AppLockCoordinator
    @EnvironmentObject var session: SessionStore
    @State private var pushRequestPending = false
    @State private var pushStatus: PushAuthorizationStatus = .notDetermined
    @State private var showSignOutConfirm = false

    var body: some View {
        List {
            Section {
                sectionRow(title: "Membership", value: "Managed on the web", icon: "creditcard")
            } header: {
                sectionHeader("Membership")
            } footer: {
                Text("Your BlackOut membership is created and managed on blackouttrades.com. The app is sign-in only.")
                    .font(BOFont.caption)
                    .foregroundStyle(BOColor.textCaption)
            }

            Section(header: sectionHeader("Security")) {
                NavigationLink(destination: SecuritySettingsView()) {
                    HStack(spacing: BOSpacing.snug) {
                        Image(systemName: "faceid").foregroundStyle(BOColor.textAccent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("App lock").font(BOFont.body).foregroundStyle(BOColor.textPrimary)
                            Text(appLock.isEnabled ? "On" : "Off")
                                .font(BOFont.caption)
                                .foregroundStyle(appLock.isEnabled ? BOColor.textAccent : BOColor.textCaption)
                        }
                    }
                }
                .listRowBackground(BOColor.backgroundCard)
            }

            Section(header: sectionHeader("Notifications")) {
                Button {
                    Task { await enableNotifications() }
                } label: {
                    HStack(spacing: BOSpacing.snug) {
                        Image(systemName: "bell.badge").foregroundStyle(BOColor.textAccent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pushStatusTitle).font(BOFont.body).foregroundStyle(BOColor.textPrimary)
                            Text(pushStatusSubtitle).font(BOFont.caption).foregroundStyle(BOColor.textCaption)
                        }
                        Spacer()
                        if pushRequestPending {
                            ProgressView().tint(BOColor.textAccent)
                        }
                    }
                }
                .disabled(pushRequestPending || pushStatus == .authorized)
                .listRowBackground(BOColor.backgroundCard)
            }

            Section(header: sectionHeader("About")) {
                infoRow(title: "Version", value: AppConfig.appVersion, icon: "info.circle")
                if let url = URL(string: AppConfig.backendURL.absoluteString + "/privacy") {
                    Link(destination: url) {
                        HStack(spacing: BOSpacing.snug) {
                            Image(systemName: "lock.doc").foregroundStyle(BOColor.textAccent)
                            Text("Privacy").font(BOFont.body).foregroundStyle(BOColor.textPrimary)
                            Spacer()
                            Image(systemName: "arrow.up.right.square").foregroundStyle(BOColor.textCaption)
                        }
                    }
                    .listRowBackground(BOColor.backgroundCard)
                }
                if let mailto = URL(string: "mailto:support@blackouttrades.com") {
                    Link(destination: mailto) {
                        HStack(spacing: BOSpacing.snug) {
                            Image(systemName: "questionmark.circle").foregroundStyle(BOColor.textAccent)
                            Text("Support").font(BOFont.body).foregroundStyle(BOColor.textPrimary)
                            Spacer()
                            Image(systemName: "envelope").foregroundStyle(BOColor.textCaption)
                        }
                    }
                    .listRowBackground(BOColor.backgroundCard)
                }
            }

            Section(header: sectionHeader("Session")) {
                Button(role: .destructive) {
                    showSignOutConfirm = true
                } label: {
                    HStack(spacing: BOSpacing.snug) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .foregroundStyle(BOColor.statusNegative)
                        Text("Sign out")
                            .font(BOFont.body)
                            .foregroundStyle(BOColor.statusNegative)
                    }
                }
                .listRowBackground(BOColor.backgroundCard)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(BOColor.backgroundBase.ignoresSafeArea())
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.large)
        .task {
            pushStatus = await PushRegistrationService.live().status()
        }
        .confirmationDialog(
            "Sign out of BlackOut?",
            isPresented: $showSignOutConfirm,
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) { session.signOut() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to see live signals, watchlist, and the graded plays.")
        }
    }

    private var pushStatusTitle: String {
        switch pushStatus {
        case .notDetermined: return "Enable push notifications"
        case .authorized:    return "Push enabled"
        case .provisional:   return "Push provisional (silent)"
        case .ephemeral:     return "Push ephemeral"
        case .denied:        return "Push denied in iOS Settings"
        }
    }

    private var pushStatusSubtitle: String {
        switch pushStatus {
        case .notDetermined: return "SPX regime, setup confirmations, and wall/flip alerts."
        case .authorized:    return "Alerts will arrive as soon as they trigger."
        case .provisional:   return "Delivered to Notification Center without banner. Change in iOS Settings."
        case .ephemeral:     return "Temporary; not applicable to full app."
        case .denied:        return "Open iOS Settings → BlackOut → Notifications to re-enable."
        }
    }

    private func enableNotifications() async {
        pushRequestPending = true
        defer { pushRequestPending = false }
        let svc = PushRegistrationService.live()
        do {
            pushStatus = try await svc.requestAuthorizationAndRegister()
        } catch let err as PushRegistrationError {
            // Refresh from source of truth (the OS) so a denied state renders correctly.
            pushStatus = await svc.status()
            _ = err // future work: surface to a toast + banner (part of the toast system).
        } catch {
            pushStatus = await svc.status()
        }
    }

    // MARK: - Row / header helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(BOFont.label)
            .textCase(.uppercase)
            .tracking(1.4)
            .foregroundStyle(BOColor.textCaption)
    }

    private func sectionRow(title: String, value: String, icon: String) -> some View {
        HStack(spacing: BOSpacing.snug) {
            Image(systemName: icon).foregroundStyle(BOColor.textAccent)
            Text(title).font(BOFont.body).foregroundStyle(BOColor.textPrimary)
            Spacer()
            Text(value).font(BOFont.caption).foregroundStyle(BOColor.textCaption)
        }
        .listRowBackground(BOColor.backgroundCard)
    }

    private func infoRow(title: String, value: String, icon: String) -> some View {
        HStack(spacing: BOSpacing.snug) {
            Image(systemName: icon).foregroundStyle(BOColor.textAccent)
            Text(title).font(BOFont.body).foregroundStyle(BOColor.textPrimary)
            Spacer()
            Text(value).font(BOFont.numericCaption).foregroundStyle(BOColor.textCaption).monospacedDigit()
        }
        .listRowBackground(BOColor.backgroundCard)
    }
}

#Preview("Account") {
    NavigationStack {
        AccountView()
            .environmentObject(AppLockCoordinator())
            .environmentObject(SessionStore())
    }
    .preferredColorScheme(.dark)
    .tint(BOColor.textAccent)
}
