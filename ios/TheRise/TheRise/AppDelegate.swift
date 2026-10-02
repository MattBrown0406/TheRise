import UIKit
import RevenueCat

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
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

        return true
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
}
