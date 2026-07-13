import UIKit
import RevenueCat

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        Purchases.logLevel = .debug
        Purchases.configure(withAPIKey: SubscriptionConfig.RevenueCat.publicSDKKey)

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = RiseViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
