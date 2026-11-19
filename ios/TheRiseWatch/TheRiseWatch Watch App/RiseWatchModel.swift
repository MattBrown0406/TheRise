// UNCOMPILED. Written for the watchOS 10 SDK in Swift 5 mode; see
// docs/watch-app.md. Every rule this file applies - provenance, Oregon's
// clock, the queue, nearest water, USGS parsing - lives in
// RiseWatchModels.swift, which is Foundation-only and tested by
// scripts/test-rise-store.sh. This file only holds state and carries the
// decisions out.

import Foundation
import SwiftUI
import WatchKit

/// Where the Watch keeps its two files. Application Support, like the
/// iPhone's journal mirror: not UserDefaults, so no required-reason API.
enum RiseWatchFiles {
    static var directory: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("TheRiseWatch", isDirectory: true)
    }

    /// The last trip pack the iPhone sent, exactly as it arrived.
    static var packURL: URL? { directory?.appendingPathComponent("trip-pack.json") }

    /// Every catch logged on this Watch until the iPhone confirms it.
    static var queueURL: URL? { directory?.appendingPathComponent("catch-queue.json") }
}

/// Readings the Watch fetched from USGS itself, on its own network.
struct RiseLiveReadings: Equatable {
    var flow: RiseWatchReading?
    var temp: RiseWatchReading?
    var fetchedAt: Date
}

enum RiseReadingKey {
    case flow, temp
}

enum RiseLocateState: Equatable {
    case idle
    case locating
    case found(waterId: String, miles: Double)
    case notNear
    case failed
}

@MainActor
final class RiseWatchModel: ObservableObject {
    /// As long as the phone's Fish on! keeps its Undo.
    static let undoSeconds: TimeInterval = 8
    /// How long a new catch waits for length and species before it is sealed
    /// and sent. Leaving the app seals it at once.
    static let detailsSeconds: TimeInterval = 60
    /// The second half of a double tap is not a second fish.
    static let repeatSeconds: TimeInterval = 2
    /// The Watch asks USGS at most this often per water.
    static let liveRefreshSeconds: TimeInterval = 600

    @Published private(set) var pack: RiseWatchPack?
    @Published private(set) var queue = RiseCatchQueue()
    @Published private(set) var live: [String: RiseLiveReadings] = [:]
    @Published private(set) var flyPosition: [String: Int] = [:]
    @Published private(set) var locateState: RiseLocateState = .idle
    @Published private(set) var lastCatch: RiseWatchCatch?
    @Published private(set) var undoUntil: Date?
    @Published private(set) var saveError: String?
    @Published var path: [String] = []
    @Published var detailsFor: RiseWatchCatch?

    private let connector = RiseWatchConnector()
    private let locator = RiseWatchLocator()
    private var started = false
    private var lastFishOnAt: Date?
    private var sealTask: Task<Void, Never>?
    private var liveInFlight: Set<String> = []
    private var lastLiveAttempt: [String: Date] = [:]

    // MARK: Start-up

    func start() {
        guard !started else { return }
        started = true
        loadFromDisk()
        connector.model = self
        connector.activate()
    }

    private func loadFromDisk() {
        if let url = RiseWatchFiles.packURL, let data = try? Data(contentsOf: url) {
            pack = RiseWatchPack.decode(data)
        }
        guard let url = RiseWatchFiles.queueURL else { return }
        var loaded = RiseCatchQueue.load(from: url)
        // A catch left as a draft by a killed app is a catch: it is kept and
        // sent, never silently dropped.
        loaded.seal()
        loaded.prune(now: Date())
        if loaded.save(to: url) {
            queue = loaded
        } else {
            queue = loaded
            saveError = "This Watch could not save its catch list. Free up space on the Watch."
        }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .background:
            // Leaving the app ends the details window: seal and send.
            seal(nil)
        case .active:
            sendQueued()
        default:
            break
        }
    }

    // MARK: The trip pack

    func receivePack(_ incoming: RiseWatchPack, data: Data) {
        if let current = pack?.generatedDate, let arriving = incoming.generatedDate, arriving < current { return }
        if let url = RiseWatchFiles.packURL {
            RiseJSONFile.write(data, to: url)
        }
        pack = incoming
    }

    var orderedWaters: [RiseWatchWater] {
        // The page already sends home, then saved, then the top pick.
        pack?.waters ?? []
    }

    func asOfText(now: Date = Date()) -> String {
        guard let generated = pack?.generatedDate else { return "" }
        return RisePacific.asOfLabel(generated, now: now)
    }

    /// True when the pack was built on an earlier Pacific day.
    func packIsOld(now: Date = Date()) -> Bool {
        guard let pack = pack else { return false }
        return pack.pacificDate != RisePacific.dayKey(now)
    }

    // MARK: Readings

    /// The pack's reading, unless this Watch has measured something newer.
    func reading(_ water: RiseWatchWater, _ key: RiseReadingKey) -> RiseWatchReading {
        let packed = key == .flow ? water.flow : water.temp
        let fetched = key == .flow ? live[water.id]?.flow : live[water.id]?.temp
        guard let own = fetched else { return packed }
        let packedIsMeasurement = packed.source == .measured || packed.source == .stale
        if packedIsMeasurement,
           let packedTaken = RiseReadingRules.takenAt(packed, packGeneratedAt: pack?.generatedDate),
           let ownTaken = RisePacific.parseISO(own.observedAt),
           packedTaken >= ownTaken {
            return packed
        }
        return own
    }

    func stamped(_ water: RiseWatchWater, _ key: RiseReadingKey, now: Date) -> RiseStampedReading {
        RiseReadingRules.stamp(reading(water, key), packGeneratedAt: pack?.generatedDate, now: now)
    }

    /// Asks USGS directly when the Watch has its own Wi-Fi or cellular. Any
    /// failure - no network, a timeout, a no-data sensor - is silent: the
    /// pack's reading, with its age, is what stays on screen.
    func refreshLive(_ water: RiseWatchWater) async {
        guard let site = water.usgsSite, !liveInFlight.contains(water.id) else { return }
        if let last = lastLiveAttempt[water.id], Date().timeIntervalSince(last) < Self.liveRefreshSeconds { return }
        liveInFlight.insert(water.id)
        lastLiveAttempt[water.id] = Date()
        defer { liveInFlight.remove(water.id) }
        guard let result = await RiseWatchLiveFetch.fetch(site: site) else { return }
        let converted = RiseUsgs.readings(result, for: water)
        guard converted.flow != nil || converted.temp != nil else { return }
        live[water.id] = RiseLiveReadings(flow: converted.flow, temp: converted.temp, fetchedAt: Date())
    }

    // MARK: Flies

    func currentFly(_ water: RiseWatchWater) -> String {
        guard !water.flies.isEmpty else { return "" }
        return water.flies[(flyPosition[water.id] ?? 0) % water.flies.count]
    }

    /// "Not working": the next fly in the pack's order, round to the first.
    /// Remembered for this session, as the phone remembers it.
    func nextFly(_ water: RiseWatchWater) {
        guard water.flies.count > 1 else { return }
        flyPosition[water.id] = ((flyPosition[water.id] ?? 0) + 1) % water.flies.count
        WKInterfaceDevice.current().play(.click)
    }

    // MARK: Fish on!

    /// Writes the catch to the queue file first. Only a write that landed
    /// counts: if it fails, nothing is logged and the angler is told.
    func fishOn(_ water: RiseWatchWater) {
        let now = Date()
        if let last = lastFishOnAt, now.timeIntervalSince(last) < Self.repeatSeconds { return }
        // A previous catch still waiting for details is kept as it is.
        if let previous = lastCatch, queue.item(previous.watchId)?.state == .draft {
            seal([previous.watchId])
        }
        let entry = RiseWatchCatch.make(
            watchId: UUID().uuidString,
            water: water,
            fly: currentFly(water),
            flow: reading(water, .flow),
            temp: reading(water, .temp),
            packGeneratedAt: pack?.generatedDate,
            now: now
        )
        var next = queue
        guard next.add(entry, state: .draft), persist(next) else {
            saveError = "This catch could not be saved on the Watch. Nothing was logged."
            WKInterfaceDevice.current().play(.failure)
            return
        }
        lastFishOnAt = now
        lastCatch = entry
        undoUntil = now.addingTimeInterval(Self.undoSeconds)
        WKInterfaceDevice.current().play(.success)
        scheduleSeal(entry.watchId)
    }

    private func scheduleSeal(_ watchId: String) {
        sealTask?.cancel()
        sealTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.detailsSeconds * 1_000_000_000))
            guard !Task.isCancelled, let self = self else { return }
            // The details sheet seals it itself when it closes.
            if self.detailsFor?.watchId == watchId { return }
            self.seal([watchId])
        }
    }

    func canUndo(_ now: Date) -> Bool {
        guard let until = undoUntil, let entry = lastCatch else { return false }
        return now < until && queue.item(entry.watchId)?.state == .draft
    }

    /// Removes exactly the catch Fish on! wrote, by its id.
    func undo() {
        guard canUndo(Date()), let entry = lastCatch else { return }
        var next = queue
        guard next.removeDraft(entry.watchId), persist(next) else { return }
        sealTask?.cancel()
        lastCatch = nil
        undoUntil = nil
        lastFishOnAt = nil
        WKInterfaceDevice.current().play(.click)
    }

    func canAddDetails(_ entry: RiseWatchCatch) -> Bool {
        queue.item(entry.watchId)?.state == .draft
    }

    /// Editing it is keeping it: opening details ends the Undo window.
    func openDetails() {
        guard let entry = lastCatch, canAddDetails(entry) else { return }
        undoUntil = nil
        detailsFor = queue.item(entry.watchId)?.entry
    }

    func saveDetails(_ watchId: String, length: Double, species: String?) {
        var next = queue
        let lengthText = RiseWatchCatch.lengthText(length)
        let edited = next.editDraft(watchId) { entry in
            if !lengthText.isEmpty { entry.length = lengthText }
            if let species = species { entry.fish = species }
        }
        if edited {
            next.seal([watchId])
            guard persist(next) else { return }
            if lastCatch?.watchId == watchId { lastCatch = next.item(watchId)?.entry }
        }
        detailsFor = nil
        sendQueued()
    }

    /// The sheet went away without Save: keep the catch as it was logged.
    func detailsClosed(_ watchId: String) {
        if queue.item(watchId)?.state == .draft {
            seal([watchId])
        }
        if detailsFor?.watchId == watchId { detailsFor = nil }
    }

    // MARK: Sending

    private func seal(_ ids: [String]?) {
        var next = queue
        let sealed = next.seal(ids)
        guard !sealed.isEmpty, persist(next) else { return }
        if let entry = lastCatch, sealed.contains(entry.watchId) { undoUntil = nil }
        sendQueued()
    }

    /// Hands every sealed catch to WatchConnectivity, which queues it until
    /// the iPhone is in range - minutes or days later.
    func sendQueued() {
        let entries = queue.toSend
        guard !entries.isEmpty else { return }
        let handed = connector.transfer(entries)
        guard !handed.isEmpty else { return }
        var next = queue
        next.advance(handed, to: .sent)
        persist(next)
    }

    func connectorActivated(outstanding: Set<String>) {
        var next = queue
        next.requeueSent(notIn: outstanding)
        persist(next)
        sendQueued()
    }

    func markDelivered(_ watchId: String) {
        var next = queue
        next.advance([watchId], to: .delivered)
        persist(next)
    }

    /// A failed transfer is sent again the next time the app is active.
    func markFailed(_ watchId: String) {
        var next = queue
        next.requeue([watchId])
        persist(next)
    }

    func markSaved(_ ids: [String]) {
        var next = queue
        next.advance(ids, to: .saved)
        next.prune(now: Date())
        persist(next)
    }

    @discardableResult
    private func persist(_ next: RiseCatchQueue) -> Bool {
        guard let url = RiseWatchFiles.queueURL, next.save(to: url) else {
            saveError = "This Watch could not save its catch list. Free up space on the Watch."
            return false
        }
        queue = next
        saveError = nil
        return true
    }

    // MARK: Status

    func fishToday(now: Date = Date()) -> Int {
        queue.fishToday(now: now)
    }

    var unsyncedCount: Int { queue.unsyncedCount }

    // MARK: Which water am I on?

    /// Nearest pack water within two miles, from one location fix that is
    /// used for this and then dropped - never stored, never sent.
    func locate() async {
        guard locateState != .locating, let pack = pack else { return }
        locateState = .locating
        guard let fix = await locator.currentLocation() else {
            locateState = .failed
            return
        }
        if let match = RiseWatchGeo.nearestWater(in: pack.waters, lat: fix.lat, lon: fix.lon) {
            locateState = .found(waterId: match.water.id, miles: match.miles)
            path = [match.water.id]
        } else {
            locateState = .notNear
        }
    }

    var locateMessage: String? {
        switch locateState {
        case .idle, .locating:
            return nil
        case .found(let waterId, let miles):
            let name = pack?.water(id: waterId)?.name ?? "that water"
            let distance = miles < 0.1 ? "under 0.1" : String(format: "%.1f", miles)
            return "You look to be on \(name) - \(distance) mi from its mapped point."
        case .notNear:
            return "Couldn't tell which water you're on - none in your trip pack is within \(Int(RiseWatchGeo.matchMiles)) miles."
        case .failed:
            return "Couldn't get your location. Check Location for The Rise in the Watch's Settings."
        }
    }
}
