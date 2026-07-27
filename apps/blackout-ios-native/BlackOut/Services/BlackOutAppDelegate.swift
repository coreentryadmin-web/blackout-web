import UIKit
import UserNotifications

/// The one place UIKit talks to us.
///
/// SwiftUI's App lifecycle doesn't expose APNs registration callbacks —
/// `didRegisterForRemoteNotificationsWithDeviceToken` and its failure sibling
/// arrive at the `UIApplicationDelegate`. We keep the delegate minimal:
/// forward the token to `PushRegistrationService` and (optional) present
/// foreground notifications with sound + banner instead of silently
/// swallowing them.
///
/// Anything durable belongs in a service — this class is a shim.
@MainActor
final class BlackOutAppDelegate: NSObject, UIApplicationDelegate {
    /// The last APNs token the OS gave us. Kept here (not in the service)
    /// so `unregister(tokenData:)` on sign-out can pass the exact token.
    /// `nil` until first successful registration.
    private(set) var currentDeviceToken: Data?

    /// Injectable so tests can wire a fake. In production it's the live one.
    lazy var pushService: PushRegistrationService = .live()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // We install the UN delegate so foreground pushes still show a
        // banner + play sound (default is "silently drop while app is open"
        // which reads as broken to a member watching for a signal).
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // MARK: - APNs registration callbacks

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        currentDeviceToken = deviceToken
        Task { await pushService.registerToken(deviceToken) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        pushService.handleRegistrationFailure(error)
    }
}

extension BlackOutAppDelegate: UNUserNotificationCenterDelegate {
    /// When a notification arrives while the app is in the foreground, show
    /// the banner, play the sound, update the badge — do NOT silently drop
    /// (the default). Alerts are our product; they should always be visible.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    /// Tap on a notification — future work will pull `signalId`/`ticker` from
    /// `userInfo` and deep-link to the right screen (part of N-3). For now we
    /// just acknowledge so the callback contract is fulfilled.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        completionHandler()
    }
}
