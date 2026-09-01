import UIKit
import WebKit
import RevenueCat

/// WKUserContentController holds its message handlers strongly. Registering the
/// view controller directly made it own itself through the web view's
/// configuration, so deinit never ran and the handlers were never removed. This
/// proxy holds the real handler weakly and breaks that cycle.
final class RiseScriptMessageProxy: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

final class RiseViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private let photoSchemeHandler = RisePhotoSchemeHandler()

    /// The teal the Today hero, the Waters header and LaunchScreen.storyboard
    /// all paint (#155A6B). The window sits behind a web view that paints its
    /// own background, so this is only ever seen for the frame before the page
    /// draws - which is exactly why it has to match the launch screen.
    private static let shellTeal = UIColor(red: 0.086, green: 0.353, blue: 0.420, alpha: 1)

    /// Set from the web layer whenever the visible screen changes. Today and
    /// Waters put teal under the status bar and need light glyphs; the other
    /// four screens are paper and need dark ones.
    private var statusBarStyle: UIStatusBarStyle = .lightContent

    override var preferredStatusBarStyle: UIStatusBarStyle {
        statusBarStyle
    }

    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let messageProxy = RiseScriptMessageProxy(target: self)
        configuration.userContentController.add(messageProxy, name: "riseSubscription")
        configuration.userContentController.add(messageProxy, name: "riseData")
        configuration.userContentController.add(messageProxy, name: "riseStore")
        configuration.userContentController.add(messageProxy, name: "riseChrome")
        configuration.setURLSchemeHandler(photoSchemeHandler, forURLScheme: RisePhotoSchemeHandler.scheme)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = Self.shellTeal
        webView.scrollView.backgroundColor = Self.shellTeal
        // The web view now spans the whole window, so WebKit must not add its
        // own safe-area content inset on top of the padding the page already
        // derives from env(safe-area-inset-*).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        return webView
    }()

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "riseSubscription")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "riseData")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "riseStore")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "riseChrome")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.shellTeal
        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        // Pinned to the view, not the safe area. Pinning to safeAreaLayoutGuide
        // left a ~59pt band of the view's own background above a teal header on
        // every notched iPhone, and the launch screen is teal, so the app
        // opened teal -> band -> teal. The page handles the insets itself: the
        // viewport is viewport-fit=cover and every screen's top block and the
        // tab bar pad with env(safe-area-inset-*).
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        loadRiseApp()
    }

    private func loadRiseApp() {
        guard let url = Bundle.main.url(forResource: "the-rise-app", withExtension: "html", subdirectory: "Web") else {
            assertionFailure("Missing bundled The Rise HTML app.")
            return
        }
        let accessURL = url.deletingLastPathComponent()
        webView.loadFileURL(url, allowingReadAccessTo: accessURL)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "riseData" {
            handleDataFetchMessage(message)
            return
        }

        if message.name == "riseStore" {
            handleStoreMessage(message)
            return
        }

        if message.name == "riseChrome" {
            handleChromeMessage(message)
            return
        }

        guard let payload = message.body as? [String: Any],
              let action = payload["action"] as? String else {
            sendSubscriptionResult(status: "error", message: "The purchase request was incomplete.")
            return
        }

        switch action {
        case "status":
            Task { await refreshSubscriptionStatus() }
        case "purchase":
            let plan = (payload["plan"] as? String) ?? "annual"
            Task { await purchaseSubscription(plan: plan) }
        case "restore":
            Task { await restorePurchases() }
        default:
            sendSubscriptionResult(status: "error", message: "Unknown purchase action.")
        }
    }

    private func refreshSubscriptionStatus() async {
        do {
            let customerInfo = try await Purchases.shared.customerInfo()
            let prices = await localizedSubscriptionPrices()
            sendSubscriptionResult(
                status: hasProAccess(customerInfo) ? "active" : "inactive",
                message: hasProAccess(customerInfo) ? "The Rise Pro is active." : "The Rise Pro is not active yet.",
                prices: prices
            )
        } catch {
            sendSubscriptionResult(status: "error", message: "Could not check subscription status.")
        }
    }

    private func purchaseSubscription(plan: String) async {
        do {
            let offerings = try await Purchases.shared.offerings()
            guard let offering = offerings.offering(identifier: SubscriptionConfig.RevenueCat.defaultOfferingIdentifier) ?? offerings.current else {
                sendSubscriptionResult(status: "error", message: "The Rise Pro offering is not available yet.")
                return
            }

            guard let package = package(for: plan, in: offering) else {
                sendSubscriptionResult(status: "error", message: "The selected subscription package is not available yet.")
                return
            }

            let result = try await Purchases.shared.purchase(package: package)
            if result.userCancelled {
                sendSubscriptionResult(status: "cancelled", message: "Purchase cancelled.")
                return
            }

            sendSubscriptionResult(
                status: hasProAccess(result.customerInfo) ? "active" : "inactive",
                message: hasProAccess(result.customerInfo) ? "The Rise Pro is active." : "Purchase finished, but Pro access was not confirmed yet."
            )
        } catch {
            sendSubscriptionResult(status: "error", message: "Purchase failed. Please try again.")
        }
    }

    private func restorePurchases() async {
        do {
            let customerInfo = try await Purchases.shared.restorePurchases()
            sendSubscriptionResult(
                status: hasProAccess(customerInfo) ? "active" : "inactive",
                message: hasProAccess(customerInfo) ? "The Rise Pro has been restored." : "No active The Rise Pro purchase was found."
            )
        } catch {
            sendSubscriptionResult(status: "error", message: "Restore failed. Please try again.")
        }
    }

    private func package(for plan: String, in offering: Offering) -> Package? {
        let annual = plan == "annual"
        let packageIdentifier = annual
            ? SubscriptionConfig.RevenueCat.annualPackageIdentifier
            : SubscriptionConfig.RevenueCat.monthlyPackageIdentifier
        let productIdentifier = annual
            ? SubscriptionConfig.RevenueCat.annualProductIdentifier
            : SubscriptionConfig.RevenueCat.monthlyProductIdentifier

        return offering.availablePackages.first { $0.identifier == packageIdentifier }
            ?? offering.availablePackages.first { $0.storeProduct.productIdentifier == productIdentifier }
    }

    private func hasProAccess(_ customerInfo: CustomerInfo) -> Bool {
        customerInfo.entitlements[SubscriptionConfig.RevenueCat.proEntitlementIdentifier]?.isActive == true
    }

    private func localizedSubscriptionPrices() async -> [String: String] {
        do {
            let offerings = try await Purchases.shared.offerings()
            guard let offering = offerings.offering(identifier: SubscriptionConfig.RevenueCat.defaultOfferingIdentifier) ?? offerings.current else {
                return [:]
            }

            var prices: [String: String] = [:]
            if let monthly = package(for: "monthly", in: offering) {
                prices["monthly"] = monthly.storeProduct.localizedPriceString
            }
            if let annual = package(for: "annual", in: offering) {
                prices["annual"] = annual.storeProduct.localizedPriceString
            }
            return prices
        } catch {
            return [:]
        }
    }

    private func sendSubscriptionResult(status: String, message: String, prices: [String: String] = [:]) {
        var payload: [String: Any] = [
            "status": status,
            "active": status == "active",
            "message": message
        ]
        if !prices.isEmpty {
            payload["prices"] = prices
        }

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("window.riseSubscriptionResult && window.riseSubscriptionResult(\(json));")
        }
    }

    private func handleStoreMessage(_ message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let action = payload["action"] as? String else {
            return
        }

        switch action {
        case "savePhoto":
            guard let identifier = payload["id"] as? String, let body = payload["body"] as? String else { return }
            RiseStore.savePhoto(identifier: identifier, dataURL: body)
        case "deletePhoto":
            guard let identifier = payload["id"] as? String else { return }
            RiseStore.deletePhoto(identifier: identifier)
        case "saveLog":
            guard let body = payload["body"] as? String else { return }
            RiseStore.saveLog(body)
        case "exportLog":
            guard let body = payload["body"] as? String else { return }
            presentExport(csv: body)
        default:
            break
        }
    }

    /// The page tells the container which glyph colour the status bar needs for
    /// the screen now on top. An unrecognised or missing value leaves the
    /// current style alone rather than guessing.
    private func handleChromeMessage(_ message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let requested = payload["statusBar"] as? String else {
            return
        }

        let style: UIStatusBarStyle
        switch requested {
        case "light":
            style = .lightContent
        case "dark":
            style = .darkContent
        default:
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.statusBarStyle != style else { return }
            self.statusBarStyle = style
            self.setNeedsStatusBarAppearanceUpdate()
        }
    }

    private func presentExport(csv: String) {
        guard let url = RiseStore.exportURL(csv: csv) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            controller.popoverPresentationController?.sourceView = self.view
            controller.popoverPresentationController?.sourceRect = CGRect(
                x: self.view.bounds.midX,
                y: self.view.bounds.midY,
                width: 0,
                height: 0
            )
            controller.popoverPresentationController?.permittedArrowDirections = []
            self.present(controller, animated: true)
        }
    }

    /// Hands the container's copy of the journal back to the web layer, which
    /// restores it if localStorage has been cleared or has fallen behind.
    private func restoreLogIfAvailable() {
        guard let json = RiseStore.loadLog() else { return }
        let payload: [String: Any] = ["body": json]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let encoded = String(data: data, encoding: .utf8) else {
            return
        }
        webView.evaluateJavaScript("window.riseLogRestore && window.riseLogRestore(\(encoded));")
    }

    /// The only hosts the web layer may ask the container to fetch. The bridge
    /// used to relay any http(s) URL the page handed it, which made it a general
    /// purpose proxy sitting inside the app.
    private static let allowedFetchHosts: Set<String> = [
        "waterservices.usgs.gov",
        "api.weather.gov",
        "myodfw.com",
        "www.myodfw.com"
    ]

    private func handleDataFetchMessage(_ message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let requestId = payload["id"] as? String,
              let urlString = payload["url"] as? String,
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              Self.allowedFetchHosts.contains(host) else {
            sendDataFetchResult(
                id: (message.body as? [String: Any])?["id"] as? String ?? "",
                statusCode: 0,
                body: "",
                error: "Blocked data request."
            )
            return
        }

        Task {
            do {
                var request = URLRequest(url: url)
                request.timeoutInterval = 12
                request.setValue("The Rise iOS/1.0 (Central Oregon fly-fishing companion)", forHTTPHeaderField: "User-Agent")
                request.setValue("*/*", forHTTPHeaderField: "Accept")

                let (data, response) = try await URLSession.shared.data(for: request)
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
                let body = String(data: data, encoding: .utf8) ?? ""
                let error = (200..<300).contains(statusCode) ? "" : "HTTP \(statusCode)"
                sendDataFetchResult(id: requestId, statusCode: statusCode, body: body, error: error)
            } catch {
                sendDataFetchResult(id: requestId, statusCode: 0, body: "", error: error.localizedDescription)
            }
        }
    }

    private func sendDataFetchResult(id: String, statusCode: Int, body: String, error: String) {
        let payload: [String: Any] = [
            "id": id,
            "ok": error.isEmpty,
            "status": statusCode,
            "body": body,
            "error": error
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("window.riseNativeFetchResult && window.riseNativeFetchResult(\(json));")
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        restoreLogIfAvailable()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url,
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            decisionHandler(.allow)
            return
        }

        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }
}
