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
/// - Acknowledgements: every id the page confirmed is remembered in
///   `watch-acked-ids.json` (bounded). A catch that arrives again with an
///   acknowledged id - the Watch resent it, perhaps after the angler deleted
///   it on the phone - is not held or offered again, only acknowledged
///   again. An acknowledgement that could not be handed to WatchConnectivity
///   (no session yet, Watch app not installed) is kept and sent at the next
///   activation, or when the Watch becomes reachable.
///
/// The session is activated from AppDelegate at launch, so a catch the
/// system delivers while the page is not loaded still lands in the file.
/// WatchConnectivity is safe on an iPhone with no Watch, or with the Watch app
/// not installed: nothing is sent, and nothing arrives.
final class RiseWatchBridge: NSObject, WCSessionDelegate {
    static let shared = RiseWatchBridge()

    private static let pendingFileName = "watch-pending-catches.json"
    private static let ackFileName = "watch-acked-ids.json"

    /// Serialises the pending file, the acknowledgement log and the latest
    /// pack. Never blocks on main.
    private let queue = DispatchQueue(label: "com.mattbrown.therise.watch-bridge")
    /// Catches that arrived but could not be written to the file (a full
    /// disk). Kept in memory and still offered to the page, so a delivery the
    /// system considers done is not lost for this run of the app.
    private var unsavedIncoming: [RiseWatchCatch] = []
    private var latestPackContext: [String: Any]?
    /// The acknowledgement log, once read. While the file could not be read
    /// (`ackLogOwned` false) changes are kept here and merged in, never
    /// written over the file.
    private var ackLog: RiseWatchAckLog?
    private var ackLogOwned = false

    /// Main thread only: set and read from the @MainActor methods below.
    private weak var page: RiseWatchPageHost?
    private var pageReady = false

    private override init() {
        super.init()
    }

    private var pendingURL: URL? {
        RiseStore.baseDirectory?.appendingPathComponent(Self.pendingFileName)
    }

    private var ackURL: URL? {
        RiseStore.baseDirectory?.appendingPathComponent(Self.ackFileName)
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

    /// The app came back to the foreground: offer held catches again (a
    /// journal write that failed for lack of space may succeed now) and send
    /// any acknowledgement still owed to the Watch.
    @MainActor
    func appDidBecomeActive() {
        deliverPendingToPage()
        queue.async { [weak self] in
            self?.flushAcknowledgements()
        }
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

    /// Everything held for the page, and whether the pending file may be
    /// written: false when it is there but could not be read just now (or a
    /// damaged copy could not be moved aside), so it is never overwritten.
    private func loadPending() -> (held: [RiseWatchCatch], writable: Bool) {
        guard let url = pendingURL else { return (unsavedIncoming, false) }
        switch RiseWatchInbox.load(from: url) {
        case .loaded(let held):
            return (RiseWatchInbox.merged(held, with: unsavedIncoming), true)
        case .missing:
            return (unsavedIncoming, true)
        case .unreadable:
            // Damaged: keep it for support, start a fresh file beside it.
            return (unsavedIncoming, RiseJSONFile.setAside(url) != nil)
        case .readFailed:
            // Only failed to read (for example before the first unlock).
            // Left exactly as it is and read again next time.
            return (unsavedIncoming, false)
        }
    }

    private func persistIncoming(_ incoming: [RiseWatchCatch]) {
        var log = loadAckLog()
        let split = RiseWatchInbox.split(incoming, acked: log)
        if !split.alreadySaved.isEmpty {
            // The journal took these already, and the angler may have deleted
            // them since: acknowledge again, never offer them to the page.
            log.record(split.alreadySaved)
            storeAckLog(log)
            flushAcknowledgements()
        }
        guard !split.fresh.isEmpty else { return }
        let pending = loadPending()
        let merged = RiseWatchInbox.merged(pending.held, with: split.fresh)
        if pending.writable, let url = pendingURL, RiseWatchInbox.save(merged, to: url) {
            unsavedIncoming = []
        } else {
            unsavedIncoming = RiseWatchInbox.merged(unsavedIncoming, with: split.fresh)
        }
    }

    private func confirmSaved(_ ids: [String]) {
        let pending = loadPending()
        let remaining = RiseWatchInbox.removing(ids, from: pending.held)
        unsavedIncoming = RiseWatchInbox.removing(ids, from: unsavedIncoming)
        if pending.writable, let url = pendingURL, RiseWatchInbox.save(remaining, to: url) {
            unsavedIncoming = []
        }
        // Remembered first, so a resend of any of these is never offered to
        // the page again; then the Watch is told, now or at the next chance.
        var log = loadAckLog()
        log.record(ids)
        storeAckLog(log)
        flushAcknowledgements()
    }

    @MainActor
    func deliverPendingToPage() {
        guard pageReady, let page = page else { return }
        let held = queue.sync { loadPending().held }
        guard let script = RiseWatchTransfer.pageScript(for: held) else { return }
        page.runWatchScript(script)
    }

    // MARK: Acknowledgements (on `queue`)

    private func loadAckLog() -> RiseWatchAckLog {
        if let log = ackLog { return log }
        guard let url = ackURL else {
            ackLog = RiseWatchAckLog()
            return RiseWatchAckLog()
        }
        switch RiseWatchAckLog.load(from: url) {
        case .loaded(let log):
            ackLog = log
            ackLogOwned = true
        case .missing:
            ackLog = RiseWatchAckLog()
            ackLogOwned = true
        case .unreadable:
            ackLog = RiseWatchAckLog()
            ackLogOwned = RiseJSONFile.setAside(url) != nil
        case .readFailed:
            ackLog = RiseWatchAckLog()
            ackLogOwned = false
        }
        return ackLog ?? RiseWatchAckLog()
    }

    /// Keeps the log in memory and writes it - unless the file is there and
    /// could not be read, in which case it is read again and merged first,
    /// and left alone if it still cannot be read.
    private func storeAckLog(_ log: RiseWatchAckLog) {
        ackLog = log
        guard let url = ackURL else { return }
        if !ackLogOwned {
            switch RiseWatchAckLog.load(from: url) {
            case .loaded(let onDisk):
                ackLog = onDisk.merged(with: log)
                ackLogOwned = true
            case .missing:
                ackLogOwned = true
            case .unreadable:
                ackLogOwned = RiseJSONFile.setAside(url) != nil
            case .readFailed:
                break
            }
            guard ackLogOwned else { return }
        }
        ackLog?.save(to: url)
    }

    /// Hands every acknowledgement still owed to WatchConnectivity, which
    /// queues it durably until the Watch is in range. Kept for later if the
    /// session is not ready or the Watch app is not installed.
    private func flushAcknowledgements() {
        var log = loadAckLog()
        guard !log.unsent.isEmpty, WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        let owed = log.unsent
        for ack in RiseWatchTransfer.savedAcks(ids: owed) {
            session.transferUserInfo(ack)
        }
        log.markSent(owed)
        storeAckLog(log)
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
            self?.flushAcknowledgements()
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// The angler switched to another Watch. Activate again for the new one.
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    /// The Watch app was installed, or the Watch paired: send the pack it
    /// lacks, and any acknowledgement it is owed.
    func sessionWatchStateDidChange(_ session: WCSession) {
        queue.async { [weak self] in
            self?.pushPackIfPossible()
            self?.flushAcknowledgements()
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        queue.async { [weak self] in
            self?.flushAcknowledgements()
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
