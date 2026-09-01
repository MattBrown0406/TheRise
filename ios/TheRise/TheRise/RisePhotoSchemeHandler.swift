import Foundation
import WebKit

/// Serves stored catch photos to the web layer as `risephoto://photo/<id>`,
/// so photos never have to be base64-encoded back into the DOM.
///
/// WebKit calls `start` and `stop` on the main thread. Reading the JPEG off
/// disk there blocked it, so scrolling a journal with a season's photos in it
/// stuttered against the file system - one synchronous read per visible card.
/// Reads now happen on a background queue and only the delivery hops back.
///
/// A WKURLSchemeTask must not be touched after `stop`, or WebKit traps. The
/// set of live tasks is therefore tracked and only ever read or written on the
/// main thread, which is where both delegate methods and the completion hop
/// all run.
final class RisePhotoSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "risephoto"

    private let readQueue = DispatchQueue(
        label: "com.freedominterventions.therise.photo-reads",
        qos: .userInitiated,
        attributes: .concurrent
    )

    private var liveTasks = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let token = ObjectIdentifier(urlSchemeTask)
        liveTasks.insert(token)

        let identifier = url.lastPathComponent
        readQueue.async { [weak self] in
            let data = RiseStore.loadPhoto(identifier: identifier)
            DispatchQueue.main.async {
                guard let self = self, self.liveTasks.remove(token) != nil else {
                    // The web view cancelled the load - the card scrolled away,
                    // or the screen was re-rendered. The task is already dead.
                    return
                }
                self.deliver(data: data, for: url, to: urlSchemeTask)
            }
        }
    }

    private func deliver(data: Data?, for url: URL, to urlSchemeTask: WKURLSchemeTask) {
        guard let data = data else {
            if let response = HTTPURLResponse(
                url: url,
                statusCode: 404,
                httpVersion: "HTTP/1.1",
                headerFields: ["Cache-Control": "no-store"]
            ) {
                urlSchemeTask.didReceive(response)
            }
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }

        if let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "image/jpeg",
                "Content-Length": "\(data.count)",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store"
            ]
        ) {
            urlSchemeTask.didReceive(response)
        }
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Drops the token, so the read in flight discards its result instead of
        // calling back into a task WebKit has finished with.
        liveTasks.remove(ObjectIdentifier(urlSchemeTask))
    }
}
