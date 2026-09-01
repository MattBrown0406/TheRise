import UIKit
import RevenueCat

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

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

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = RiseViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
