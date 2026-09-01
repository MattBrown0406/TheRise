import Foundation
import UIKit
import WebKit

/// Durable storage for the catch journal.
///
/// The web layer used to keep the whole journal, photos included, as base64 in
/// localStorage on a `file://` origin. That storage is small, evictable by
/// WebKit, and outside the backup path, so a user's catch history could vanish.
/// Photos now live as JPEG files in Application Support and the journal JSON is
/// mirrored there, both of which are covered by device backup.
enum RiseStore {
    private static let directoryName = "TheRise"
    private static let photosDirectoryName = "CatchPhotos"
    private static let logFileName = "catch-log.json"

    private static var baseDirectory: URL? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        let directory = support.appendingPathComponent(directoryName, isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        return directory
    }

    private static var photosDirectory: URL? {
        guard let base = baseDirectory else { return nil }
        let directory = base.appendingPathComponent(photosDirectoryName, isDirectory: true)
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        return directory
    }

    /// Identifiers come from the web layer, so anything that could escape the
    /// photos directory is rejected rather than sanitised.
    private static func isValidPhotoIdentifier(_ identifier: String) -> Bool {
        guard !identifier.isEmpty, identifier.count <= 128 else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        return identifier.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    static func photoURL(for identifier: String) -> URL? {
        guard isValidPhotoIdentifier(identifier), let directory = photosDirectory else { return nil }
        return directory.appendingPathComponent("\(identifier).jpg")
    }

    /// Accepts a `data:image/jpeg;base64,...` URL as produced by the web layer.
    static func savePhoto(identifier: String, dataURL: String) {
        guard let url = photoURL(for: identifier),
              let range = dataURL.range(of: ","),
              let data = Data(base64Encoded: String(dataURL[range.upperBound...])) else {
            return
        }
        try? data.write(to: url, options: .atomic)
    }

    static func deletePhoto(identifier: String) {
        guard let url = photoURL(for: identifier) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    static func loadPhoto(identifier: String) -> Data? {
        guard let url = photoURL(for: identifier) else { return nil }
        return try? Data(contentsOf: url)
    }

    static func saveLog(_ json: String) {
        guard let base = baseDirectory, let data = json.data(using: .utf8) else { return }
        try? data.write(to: base.appendingPathComponent(logFileName), options: .atomic)
    }

    static func loadLog() -> String? {
        guard let base = baseDirectory,
              let data = try? Data(contentsOf: base.appendingPathComponent(logFileName)) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /// Writes the CSV to a temporary file so the share sheet offers a real
    /// document rather than a wall of text.
    static func exportURL(csv: String) -> URL? {
        let filename = "the-rise-catch-log.csv"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        guard let data = csv.data(using: .utf8) else { return nil }
        try? data.write(to: url, options: .atomic)
        return url
    }
}

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
