// UNCOMPILED. Written for the watchOS 10 SDK in Swift 5 mode; see
// docs/watch-app.md.

import Foundation
import WatchConnectivity

/// The Watch half of the link. The payload shapes live in RiseWatchTransfer
/// (RiseWatchModels.swift), shared with the iPhone's RiseWatchBridge.
///
/// - The trip pack arrives as an application context. The latest one is
///   also read at activation, so a pack sent while this app was not running
///   is picked up on the next launch.
/// - Each catch goes out with transferUserInfo. The system queues it and
///   delivers it when the iPhone is next reachable, whether or not either
///   app is running; didFinish tells us when it got there.
/// - The iPhone answers "catchesSaved" once the journal holds them.
final class RiseWatchConnector: NSObject, WCSessionDelegate {
    /// Every callback is passed to the model on the main actor.
    weak var model: RiseWatchModel?

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// Hands catches to the system. Returns the ids it now carries; a catch
    /// it already carries is not handed over twice.
    func transfer(_ entries: [RiseWatchCatch]) -> [String] {
        guard WCSession.isSupported() else { return [] }
        let session = WCSession.default
        guard session.activationState == .activated else { return [] }
        let carried = outstandingIds() ?? []
        var handed: [String] = []
        for entry in entries {
            if carried.contains(entry.watchId) {
                handed.append(entry.watchId)
                continue
            }
            guard let info = RiseWatchTransfer.userInfo(for: entry) else { continue }
            session.transferUserInfo(info)
            handed.append(entry.watchId)
        }
        return handed
    }

    /// Catch ids the system is still carrying. nil until the session is
    /// activated: an empty answer then would look like every transfer lost.
    func outstandingIds() -> Set<String>? {
        guard WCSession.isSupported() else { return nil }
        let session = WCSession.default
        guard session.activationState == .activated else { return nil }
        return Set(session.outstandingUserInfoTransfers.compactMap { RiseWatchTransfer.watchId(inUserInfo: $0.userInfo) })
    }

    // MARK: WCSessionDelegate

    /// The model sends what is queued at once, and only a few seconds later
    /// looks for transfers the system dropped - after any late didFinish or
    /// catchesSaved from before has been heard.
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        let latest = RiseWatchTransfer.pack(fromApplicationContext: session.receivedApplicationContext)
        Task { @MainActor [weak self] in
            if let latest = latest {
                self?.model?.receivePack(latest.pack, data: latest.data)
            }
            self?.model?.connectorActivated()
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let latest = RiseWatchTransfer.pack(fromApplicationContext: applicationContext) else { return }
        Task { @MainActor [weak self] in
            self?.model?.receivePack(latest.pack, data: latest.data)
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        let saved = RiseWatchTransfer.savedIds(fromUserInfo: userInfo)
        guard !saved.isEmpty else { return }
        Task { @MainActor [weak self] in
            self?.model?.markSaved(saved)
        }
    }

    func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        guard let watchId = RiseWatchTransfer.watchId(inUserInfo: userInfoTransfer.userInfo) else { return }
        let delivered = error == nil
        Task { @MainActor [weak self] in
            if delivered {
                self?.model?.markDelivered(watchId)
            } else {
                self?.model?.markFailed(watchId)
            }
        }
    }
}
