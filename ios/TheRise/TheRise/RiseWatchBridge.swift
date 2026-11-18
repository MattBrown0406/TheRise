import Foundation
import WatchConnectivity

/// The web view the bridge hands catches to. RiseViewController is the only one.
@MainActor
protocol RiseWatchPageHost: AnyObject {
    func runWatchScript(_ script: String)
}

/// The iPhone half of the Apple Watch link.
///
/// - Trip pack: the page posts `{ action: "pack", body }` over the riseWatch
///   handler whenever its content changes. The pack is validated by
///   RiseWatchModels, re-encoded and sent with updateApplicationContext -
///   latest wins, and the Watch keeps it on disk.
/// - Catches: the Watch sends each one with transferUserInfo. Every catch is
///   written to `watch-pending-catches.json` in Application Support before
///   anything else happens, then handed to the page through
///   `window.riseWatchCatches` - now if the page is loaded, and again on every
///   page load. A held catch is deleted only when the page answers
///   `{ action: "catchesSaved", ids }`, which it sends only after setLogs
///   returned true. Native code never writes the journal itself.
///
/// The session is activated from AppDelegate at launch, so a catch the
/// system delivers while the page is not loaded still lands in the file.
/// WatchConnectivity is safe on an iPhone with no Watch, or with the Watch app
/// not installed: nothing is sent, and nothing arrives.
final class RiseWatchBridge: NSObject, WCSessionDelegate {
    static let shared = RiseWatchBridge()

    private static let pendingFileName = "watch-pending-catches.json"

    /// Serialises the pending file and the latest pack. Never blocks on main.
    private let queue = DispatchQueue(label: "com.mattbrown.therise.watch-bridge")
    /// Catches that arrived but could not be written to the file (a full
    /// disk). Kept in memory and still offered to the page, so a delivery the
    /// system considers done is not lost for this run of the app.
    private var unsavedIncoming: [RiseWatchCatch] = []
    private var latestPackContext: [String: Any]?

    /// Main thread only: set and read from the @MainActor methods below.
    private weak var page: RiseWatchPageHost?
    private var pageReady = false

    private override init() {
        super.init()
    }

    private var pendingURL: URL? {
        RiseStore.baseDirectory?.appendingPathComponent(Self.pendingFileName)
    }

    // MARK: Lifecycle

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// The page finished loading: it can take catches now.
    @MainActor
    func pageDidFinishLoading(_ host: RiseWatchPageHost) {
        page = host
        pageReady = true
        deliverPendingToPage()
    }

    /// The page is being (re)loaded; hold catches until didFinish.
    @MainActor
    func pageWillLoad() {
        pageReady = false
    }

    // MARK: Messages from the page

    func handlePageMessage(_ body: Any) {
        guard let payload = body as? [String: Any], let action = payload["action"] as? String else { return }
        switch action {
        case "pack":
            guard let json = payload["body"] as? String else { return }
            queue.async { [weak self] in
                guard let self = self, let context = RiseWatchTransfer.applicationContext(packJSON: json) else { return }
                self.latestPackContext = context
                self.pushPackIfPossible()
            }
        case "catchesSaved":
            let ids = (payload["ids"] as? [Any] ?? []).compactMap { $0 as? String }.filter(RiseWatchValidation.isValidWatchId)
            guard !ids.isEmpty else { return }
            queue.async { [weak self] in
                self?.confirmSaved(ids)
            }
        default:
            break
        }
    }

    // MARK: Pending catches (on `queue`)

    private func loadPending() -> [RiseWatchCatch] {
        guard let url = pendingURL else { return unsavedIncoming }
        switch RiseWatchInbox.load(from: url) {
        case .loaded(let held):
            return RiseWatchInbox.merged(held, with: unsavedIncoming)
        case .missing:
            return unsavedIncoming
        case .unreadable:
            // Never overwrite what could not be read; keep it for support.
            RiseJSONFile.setAside(url)
            return unsavedIncoming
        }
    }

    private func persistIncoming(_ incoming: [RiseWatchCatch]) {
        let merged = RiseWatchInbox.merged(loadPending(), with: incoming)
        if let url = pendingURL, RiseWatchInbox.save(merged, to: url) {
            unsavedIncoming = []
        } else {
            unsavedIncoming = RiseWatchInbox.merged(unsavedIncoming, with: incoming)
        }
    }

    private func confirmSaved(_ ids: [String]) {
        let remaining = RiseWatchInbox.removing(ids, from: loadPending())
        unsavedIncoming = RiseWatchInbox.removing(ids, from: unsavedIncoming)
        if let url = pendingURL {
            RiseWatchInbox.save(remaining, to: url)
        }
        // Tell the Watch, so its "Unsynced" count can fall. Queued by the
        // system; harmless if the Watch has since forgotten the catch.
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        session.transferUserInfo(RiseWatchTransfer.savedAck(ids: ids))
    }

    @MainActor
    private func deliverPendingToPage() {
        guard pageReady, let page = page else { return }
        let held = queue.sync { loadPending() }
        guard let script = RiseWatchTransfer.pageScript(for: held) else { return }
        page.runWatchScript(script)
    }

    // MARK: Trip pack (on `queue`)

    private func pushPackIfPossible() {
        guard WCSession.isSupported(), let context = latestPackContext else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        do {
            try session.updateApplicationContext(context)
        } catch {
            // Latest wins: the next change, or the next activation, sends it again.
        }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        queue.async { [weak self] in
            self?.pushPackIfPossible()
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// The angler switched to another Watch. Activate again for the new one.
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    /// The Watch app was installed, or the Watch paired: send the pack it lacks.
    func sessionWatchStateDidChange(_ session: WCSession) {
        queue.async { [weak self] in
            self?.pushPackIfPossible()
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        let incoming = RiseWatchTransfer.catches(fromUserInfo: userInfo)
        guard !incoming.isEmpty else { return }
        // On disk before this returns: once the delegate has been called the
        // system considers the transfer delivered.
        queue.sync {
            persistIncoming(incoming)
        }
        Task { @MainActor [weak self] in
            self?.deliverPendingToPage()
        }
    }
}
