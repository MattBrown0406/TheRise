import Foundation
import WebKit

/// Serves stored catch photos to the web layer as `risephoto://photo/<id>`,
/// so photos never have to be base64-encoded back into the DOM.
final class RisePhotoSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "risephoto"

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let identifier = url.lastPathComponent
        guard let data = RiseStore.loadPhoto(identifier: identifier) else {
            let response = HTTPURLResponse(
                url: url,
                statusCode: 404,
                httpVersion: "HTTP/1.1",
                headerFields: ["Cache-Control": "no-store"]
            )
            if let response = response {
                urlSchemeTask.didReceive(response)
            }
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "image/jpeg",
                "Content-Length": "\(data.count)",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store"
            ]
        )
        if let response = response {
            urlSchemeTask.didReceive(response)
        }
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Reads are synchronous and already complete; nothing to cancel.
    }
}
