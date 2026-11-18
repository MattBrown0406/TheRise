// UNCOMPILED. Written for the watchOS 10 SDK in Swift 5 mode; see
// docs/watch-app.md.

import Foundation

/// One anonymous read of the public USGS instantaneous-values endpoint, when
/// the Watch has its own Wi-Fi or cellular. Parsing and every rule about what
/// counts as a current reading are in RiseUsgs (RiseWatchModels.swift).
/// Short timeouts, no retries, no waiting for connectivity: on the water a
/// slow answer is no answer, and the pack's reading stays on screen.
enum RiseWatchLiveFetch {
    private static let userAgent = "The Rise watchOS/1.0 (Central Oregon fly-fishing companion)"

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 12
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    static func fetch(site: String) async -> RiseUsgsReading? {
        guard let url = RiseUsgs.url(site: site) else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            return RiseUsgs.parse(data, site: site, now: Date())
        } catch {
            return nil
        }
    }
}
