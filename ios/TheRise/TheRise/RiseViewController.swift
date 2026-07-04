import UIKit
import WebKit

final class RiseViewController: UIViewController, WKNavigationDelegate {
    private lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.969, green: 0.957, blue: 0.925, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        return webView
    }()

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
}
