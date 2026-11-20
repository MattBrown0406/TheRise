import UIKit
import RevenueCat
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // .debug printed purchase and customer traffic to the device console
        // in a shipping build. Verbose logging is for local builds only.
        #if DEBUG
        Purchases.logLevel = .debug
        #else
        Purchases.logLevel = .warn
        #endif
        Purchases.configure(withAPIKey: SubscriptionConfig.RevenueCat.publicSDKKey)

        // Alerts for saved waters. BGTaskScheduler only accepts a launch
        // handler registered before launch finishes, so this cannot wait for
        // the web view. The delegate lets an alert show while the app is open.
        UNUserNotificationCenter.current().delegate = self
        RiseNotifications.registerBackgroundTasks()

        // Apple Watch. Activated here, not when the web view loads, so a
        // catch the system delivers from the Watch while the page is not
        // loaded is still written to Application Support. A no-op on an
        // iPhone without a paired Watch.
        RiseWatchBridge.shared.activate()

        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}

/// Window ownership belongs to the scene lifecycle. UIKit terminates apps
/// linked with the iOS 27 SDK at launch if they use only the legacy app delegate.
/// Kept in this compilation unit so existing Xcode source membership is intact.
final class RiseSceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = RiseViewController()
        self.window = window
        window.makeKeyAndVisible()
    }

    /// The flow check is a background app refresh; leaving the app is the
    /// moment to make sure the next one is requested.
    func sceneDidEnterBackground(_ scene: UIScene) {
        RiseNotifications.scheduleFlowCheck()
    }

    /// Back in the app: held Watch catches are offered to the page again (a
    /// journal write that failed for lack of space may work now - the notice
    /// says "free up storage and reopen The Rise"), and any acknowledgement
    /// still owed to the Watch is sent.
    func sceneDidBecomeActive(_ scene: UIScene) {
        RiseWatchBridge.shared.appDidBecomeActive()
    }
}
