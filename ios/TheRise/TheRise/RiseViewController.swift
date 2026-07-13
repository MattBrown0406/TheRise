import UIKit
import WebKit
import RevenueCat

final class RiseViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.add(self, name: "riseSubscription")
        configuration.userContentController.add(self, name: "riseData")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.969, green: 0.957, blue: 0.925, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        return webView
    }()

    deinit {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "riseSubscription")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "riseData")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = webView.backgroundColor
        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        let safeArea = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: safeArea.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safeArea.trailingAnchor),
            webView.topAnchor.constraint(equalTo: safeArea.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safeArea.bottomAnchor)
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
            sendSubscriptionResult(
                status: hasProAccess(customerInfo) ? "active" : "inactive",
                message: hasProAccess(customerInfo) ? "The Rise Pro is active." : "The Rise Pro is not active yet."
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

    private func sendSubscriptionResult(status: String, message: String) {
        let payload: [String: Any] = [
            "status": status,
            "active": status == "active",
            "message": message
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript("window.riseSubscriptionResult && window.riseSubscriptionResult(\(json));")
        }
    }

    private func handleDataFetchMessage(_ message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let requestId = payload["id"] as? String,
              let urlString = payload["url"] as? String,
              let url = URL(string: urlString),
              ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
            sendDataFetchResult(id: (message.body as? [String: Any])?["id"] as? String ?? "", statusCode: 0, body: "", error: "Invalid data request.")
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
}
