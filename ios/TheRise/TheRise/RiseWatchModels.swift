import Foundation

// The Apple Watch link: everything both sides have to agree on, and every
// decision that can be made without a device.
//
// This file is compiled into BOTH the TheRise iPhone target and the Watch app
// target, and into scripts/test-rise-store.sh. It imports only Foundation for
// exactly that reason - no UIKit, SwiftUI, WatchKit, WatchConnectivity or
// CoreLocation - and the release checks fail if that changes. The
// WatchConnectivity halves are RiseWatchBridge.swift (iPhone) and
// RiseWatchConnector.swift (Watch).
//
// The contract, in one place (docs/watch-app.md has the long form):
//   iPhone -> Watch  updateApplicationContext ["kind": "pack", "version": 1, "pack": <JSON Data>]
//                    The trip pack the page builds. Latest wins.
//   Watch -> iPhone  transferUserInfo ["kind": "catch", "version": 1, "watchId": id, "catch": <JSON Data>]
//                    One catch. Queued by the system; survives either side being away.
//   iPhone -> Watch  transferUserInfo ["kind": "catchesSaved", "ids": [id]]
//                    Sent once the page has written those catches to the journal.

// MARK: - Provenance

/// Where a reading came from. The same four words valueProvenance() uses in
/// the-rise-app.html. Anything unrecognised decodes as unavailable: a reading
/// whose origin is unknown is not shown as a measurement.
enum RiseProvenance: String, Codable, Equatable {
    case measured
    case stale
    case reference
    case unavailable

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self)) ?? ""
        self = RiseProvenance(rawValue: raw) ?? .unavailable
    }
}

private extension KeyedDecodingContainer {
    /// A missing or malformed key reads as the fallback instead of failing
    /// the whole pack: one odd field must not cost the angler every water.
    func value<T: Decodable>(_ key: Key, or fallback: T) -> T {
        let decoded: T? = (try? decodeIfPresent(T.self, forKey: key)) ?? nil
        return decoded ?? fallback
    }

    func optionalValue<T: Decodable>(_ key: Key) -> T? {
        let decoded: T? = (try? decodeIfPresent(T.self, forKey: key)) ?? nil
        return decoded
    }
}

// MARK: - Validation

enum RiseWatchValidation {
    /// A Watch catch id: a UUID string, or anything of the same alphabet.
    static func isValidWatchId(_ identifier: String) -> Bool {
        guard (8...64).contains(identifier.count) else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")
        return identifier.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    /// Water ids are the web layer's lowercase, hyphenated slugs.
    static func isValidWaterId(_ identifier: String) -> Bool {
        guard !identifier.isEmpty, identifier.count <= 64 else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-")
        return identifier.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    /// USGS site numbers are 8 to 15 ASCII digits. Anything else never reaches a URL.
    static func isValidSiteId(_ site: String) -> Bool {
        guard (8...15).contains(site.count) else { return false }
        return site.unicodeScalars.allSatisfy { $0.isASCII && CharacterSet.decimalDigits.contains($0) }
    }

    /// Plain single-line text of bounded length.
    static func clean(_ text: String, limit: Int = 80) -> String {
        let flattened = text
            .components(separatedBy: .controlCharacters).joined(separator: " ")
            .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        return String(flattened.prefix(limit))
    }
}

// MARK: - Oregon's clock

/// Every water is in Central Oregon, so every date and time the Watch shows or
/// stamps on a catch is Pacific, whatever zone the Watch itself is in - the
/// same rule zonedParts() enforces on the page.
enum RisePacific {
    static let timeZone: TimeZone = TimeZone(identifier: "America/Los_Angeles") ?? TimeZone(secondsFromGMT: -8 * 3600)!

    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        // POSIX, so the text is the same on every Watch whatever its region:
        // these strings go into the journal beside the phone's own.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = format
        return formatter
    }

    private static let dateFormatter = formatter("MMM d, yyyy")
    private static let timeFormatter = formatter("h:mm a")
    private static let dayKeyFormatter = formatter("yyyy-MM-dd")
    private static let weekdayTimeFormatter = formatter("EEE h:mm a")
    private static let monthDayFormatter = formatter("MMM d")

    /// "Nov 18, 2026" - what zonedDateLabel() writes on an en-US iPhone.
    static func dateLabel(_ date: Date) -> String {
        dateFormatter.string(from: date)
    }

    /// "8:05 AM" - what zonedTimeLabel() writes on an en-US iPhone.
    static func timeLabel(_ date: Date) -> String {
        timeFormatter.string(from: date)
    }

    /// "2026-11-18" - pacificDateKey().
    static func dayKey(_ date: Date) -> String {
        dayKeyFormatter.string(from: date)
    }

    /// Wall-clock seconds since Pacific midnight.
    static func secondsIntoDay(_ date: Date) -> Int {
        let parts = calendar.dateComponents([.hour, .minute, .second], from: date)
        return (parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0)
    }

    /// "2026-11-18T16:05:00.000Z", exactly as Date.prototype.toISOString writes it.
    static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }

    static func parseISO(_ text: String?) -> Date? {
        guard let text = text, !text.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    /// ageLabel() from the page: "just now", "3h ago", "2 days ago".
    static func ageLabel(hours: Double) -> String {
        if hours < 1 { return "just now" }
        if hours < 24 { return "\(Int(hours.rounded()))h ago" }
        let days = Int((hours / 24).rounded())
        return "\(days) day\(days == 1 ? "" : "s") ago"
    }

    /// "as of 6:40 AM" today, "as of Tue 6:40 PM" this week, "as of Nov 2" before that.
    static func asOfLabel(_ date: Date, now: Date) -> String {
        if dayKey(date) == dayKey(now) { return "as of \(timeLabel(date))" }
        if now.timeIntervalSince(date) < 6 * 86_400 { return "as of \(weekdayTimeFormatter.string(from: date))" }
        return "as of \(monthDayFormatter.string(from: date))"
    }
}

// MARK: - The trip pack (iPhone -> Watch)

struct RiseWatchReading: Codable, Equatable {
    /// Display text exactly as the app shows it, e.g. "4,160 cfs", "53 F".
    var value: String
    var source: RiseProvenance
    /// When USGS took the reading, and when the phone cached it. ISO 8601.
    var observedAt: String?
    var cachedAt: String?
    /// The seasonal value the app falls back to once a measurement expires.
    /// Empty when there is none (an ungauged river).
    var reference: String?

    init(value: String, source: RiseProvenance, observedAt: String? = nil, cachedAt: String? = nil, reference: String? = nil) {
        self.value = value
        self.source = source
        self.observedAt = observedAt
        self.cachedAt = cachedAt
        self.reference = reference
    }

    static let none = RiseWatchReading(value: "", source: .unavailable)
}

extension RiseWatchReading {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            value: RiseWatchValidation.clean(container.value(.value, or: ""), limit: 40),
            source: container.value(.source, or: RiseProvenance.unavailable),
            observedAt: container.optionalValue(.observedAt),
            cachedAt: container.optionalValue(.cachedAt),
            reference: container.optionalValue(.reference)
        )
    }
}

struct RiseWatchWindow: Codable, Equatable {
    /// Hours on a 24-hour Pacific clock, as primeWindowHours() returns them.
    var startHour: Int
    var endHour: Int
}

struct RiseWatchPlannerDay: Codable, Equatable {
    var date: String
    var label: String
    /// nil for a day that is typically snowed in: never scored.
    var score: Double?
    var reason: String
}

struct RiseWatchPlanner: Codable, Equatable {
    var fetchedAt: String?
    var days: [RiseWatchPlannerDay]
    var best: RiseWatchPlannerDay?
}

struct RiseWatchWater: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    /// "River", "Lake", ... as the app's water data says.
    var type: String
    var home: Bool
    var saved: Bool
    var topPick: Bool
    var lat: Double?
    var lon: Double?
    var usgsSite: String?
    var score: Double?
    /// scoreSourceLabel(): "Live-adjusted score", "Cached score - readings 14h ago", ...
    var scoreSource: String
    /// nil when wind decides the window.
    var primeWindow: RiseWatchWindow?
    var flow: RiseWatchReading
    var temp: RiseWatchReading
    var flies: [String]
    var hatches: [String]
    var planner: RiseWatchPlanner?
}

extension RiseWatchWater {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let site: String? = container.optionalValue(.usgsSite)
        self.init(
            id: container.value(.id, or: ""),
            name: RiseWatchValidation.clean(container.value(.name, or: "")),
            type: RiseWatchValidation.clean(container.value(.type, or: ""), limit: 20),
            home: container.value(.home, or: false),
            saved: container.value(.saved, or: false),
            topPick: container.value(.topPick, or: false),
            lat: container.optionalValue(.lat),
            lon: container.optionalValue(.lon),
            usgsSite: site.flatMap { RiseWatchValidation.isValidSiteId($0) ? $0 : nil },
            score: container.optionalValue(.score),
            scoreSource: RiseWatchValidation.clean(container.value(.scoreSource, or: ""), limit: 80),
            primeWindow: container.optionalValue(.primeWindow),
            flow: container.value(.flow, or: RiseWatchReading.none),
            temp: container.value(.temp, or: RiseWatchReading.none),
            flies: Array(container.value(.flies, or: [String]()).map { RiseWatchValidation.clean($0, limit: 60) }.filter { !$0.isEmpty }.prefix(10)),
            hatches: Array(container.value(.hatches, or: [String]()).map { RiseWatchValidation.clean($0, limit: 40) }.prefix(6)),
            planner: container.optionalValue(.planner)
        )
    }

    var isLake: Bool { type.lowercased() == "lake" }
}

struct RiseWatchPack: Codable, Equatable {
    static let currentVersion = 1
    static let maxWaters = 12
    /// WatchConnectivity does not document a context limit; stay well under
    /// the ~65 KB its message calls accept.
    static let maxEncodedBytes = 48_000

    var version: Int
    var generatedAt: String
    var pacificDate: String
    var homeWaterId: String?
    var species: [String]
    var waters: [RiseWatchWater]

    var generatedDate: Date? { RisePacific.parseISO(generatedAt) }

    func water(id: String) -> RiseWatchWater? {
        waters.first { $0.id == id }
    }

    /// Validates what arrived: a pack with no usable water, or from a
    /// version this build does not understand, is no pack.
    static func decode(_ data: Data) -> RiseWatchPack? {
        guard var pack = try? JSONDecoder().decode(RiseWatchPack.self, from: data),
              pack.version >= 1, pack.version <= currentVersion,
              pack.generatedDate != nil else {
            return nil
        }
        var seen = Set<String>()
        pack.waters = pack.waters.filter { water in
            guard RiseWatchValidation.isValidWaterId(water.id), !water.name.isEmpty, !seen.contains(water.id) else { return false }
            seen.insert(water.id)
            return true
        }
        pack.waters = Array(pack.waters.prefix(maxWaters))
        pack.species = Array(pack.species.map { RiseWatchValidation.clean($0, limit: 60) }.filter { !$0.isEmpty }.prefix(20))
        guard !pack.waters.isEmpty else { return nil }
        return pack
    }

    /// The bytes sent to the Watch. Planner days go first if the pack is
    /// too large, then the tail of the water list; home stays first.
    func encodedForTransfer() -> Data? {
        let encoder = JSONEncoder()
        guard let full = try? encoder.encode(self) else { return nil }
        if full.count <= Self.maxEncodedBytes { return full }
        var trimmed = self
        trimmed.waters = trimmed.waters.map { water in
            var copy = water
            copy.planner = nil
            return copy
        }
        while let data = try? encoder.encode(trimmed) {
            if data.count <= Self.maxEncodedBytes { return data }
            guard trimmed.waters.count > 1 else { return nil }
            trimmed.waters.removeLast()
        }
        return nil
    }
}

extension RiseWatchPack {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            version: container.value(.version, or: 0),
            generatedAt: container.value(.generatedAt, or: ""),
            pacificDate: container.value(.pacificDate, or: ""),
            homeWaterId: container.optionalValue(.homeWaterId),
            species: container.value(.species, or: [String]()),
            waters: container.value(.waters, or: [RiseWatchWater]())
        )
    }
}

// MARK: - Readings at the moment of a catch

/// A reading as the Watch shows it now, or stamps it on a catch.
struct RiseStampedReading: Equatable {
    var value: String
    var source: RiseProvenance
    /// When the measurement was taken, for "measured 3h ago". nil for a
    /// reference value, or a measurement whose time is unknown.
    var takenAt: Date?
}

/// The provenance rules, applied again on the Watch because a pack can be
/// hours or days old by the time a fish is caught.
///
/// - measured stays measured only inside the app's fresh window
///   (READING_FRESH_HOURS, 12 h), measured from the older of when USGS took
///   it and when the phone cached it; after that it is stale ("measured
///   earlier", with its age).
/// - stale stays stale. Nothing is ever upgraded.
/// - past READING_EXPIRY_HOURS (7 days) a measurement is not used at all: the
///   reading falls back to the water's seasonal value, labelled reference, as
///   the page does - or to nothing, if the water has no seasonal value.
/// - reference and unavailable are passed through as they are.
enum RiseReadingRules {
    static let freshHours: Double = 12
    static let expiryHours: Double = 24 * 7

    static func takenAt(_ reading: RiseWatchReading, packGeneratedAt: Date?) -> Date? {
        let times = [reading.observedAt, reading.cachedAt].compactMap { RisePacific.parseISO($0) }
        return times.min() ?? packGeneratedAt
    }

    static func stamp(_ reading: RiseWatchReading, packGeneratedAt: Date?, now: Date) -> RiseStampedReading {
        switch reading.source {
        case .reference, .unavailable:
            return RiseStampedReading(value: reading.value, source: reading.source, takenAt: nil)
        case .measured, .stale:
            guard let taken = takenAt(reading, packGeneratedAt: packGeneratedAt) else {
                // A measurement with no time cannot be called current.
                return RiseStampedReading(value: reading.value, source: .stale, takenAt: nil)
            }
            let ageHours = now.timeIntervalSince(taken) / 3600
            if ageHours >= expiryHours {
                let fallback = reading.reference ?? ""
                return fallback.isEmpty
                    ? RiseStampedReading(value: "", source: .unavailable, takenAt: nil)
                    : RiseStampedReading(value: fallback, source: .reference, takenAt: nil)
            }
            if reading.source == .stale || ageHours >= freshHours {
                return RiseStampedReading(value: reading.value, source: .stale, takenAt: taken)
            }
            return RiseStampedReading(value: reading.value, source: .measured, takenAt: taken)
        }
    }

    /// The words printed beside the number: "measured 3h ago", "reference".
    static func label(_ stamped: RiseStampedReading, now: Date) -> String {
        switch stamped.source {
        case .measured, .stale:
            guard let taken = stamped.takenAt else { return "measured earlier" }
            return "measured \(RisePacific.ageLabel(hours: max(0, now.timeIntervalSince(taken) / 3600)))"
        case .reference:
            return "reference"
        case .unavailable:
            return ""
        }
    }
}

// MARK: - Prime window

struct RisePrimeWindowStatus: Equatable {
    enum State: String {
        case before, during, after, unknown
    }

    var state: State
    var text: String
    var range: String
}

/// primeWindowCountdown() from the page, counted on the Watch from the hours
/// in the pack, on Oregon's clock.
enum RisePrimeWindow {
    static func formatHour(_ hour: Int) -> String {
        let normalized = ((hour % 24) + 24) % 24
        let suffix = normalized >= 12 ? "PM" : "AM"
        let display = normalized % 12 == 0 ? 12 : normalized % 12
        return "\(display) \(suffix)"
    }

    static func durationLabel(seconds: Int) -> String {
        let minutes = max(1, Int((Double(seconds) / 60).rounded(.up)))
        let hours = minutes / 60
        let rest = minutes % 60
        if hours == 0 { return "\(rest)m" }
        return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m"
    }

    static func status(_ window: RiseWatchWindow?, now: Date) -> RisePrimeWindowStatus {
        guard let window = window else {
            return RisePrimeWindowStatus(state: .unknown, text: "Prime window: first calm hour", range: "Wind is deciding the window today")
        }
        let range = "\(formatHour(window.startHour))-\(formatHour(window.endHour)) Pacific"
        let secondsNow = RisePacific.secondsIntoDay(now)
        if secondsNow < window.startHour * 3600 {
            return RisePrimeWindowStatus(state: .before, text: "Prime window starts in \(durationLabel(seconds: window.startHour * 3600 - secondsNow))", range: range)
        }
        if secondsNow < window.endHour * 3600 {
            return RisePrimeWindowStatus(state: .during, text: "Prime window ends in \(durationLabel(seconds: window.endHour * 3600 - secondsNow))", range: range)
        }
        return RisePrimeWindowStatus(state: .after, text: "Prime window has passed for today", range: range)
    }
}

// MARK: - Which water am I on?

struct RiseWaterMatch: Equatable {
    var water: RiseWatchWater
    var miles: Double
}

enum RiseWatchGeo {
    /// ON_WATER_MATCH_MILES on the page.
    static let matchMiles: Double = 2

    /// milesBetween() from the page: haversine on a 3,958.8-mile Earth.
    static func miles(fromLat: Double, fromLon: Double, toLat: Double, toLon: Double) -> Double {
        let earthMiles = 3958.8
        let toRadians = { (value: Double) -> Double in value * Double.pi / 180 }
        let dLat = toRadians(toLat - fromLat)
        let dLon = toRadians(toLon - fromLon)
        let lat1 = toRadians(fromLat)
        let lat2 = toRadians(toLat)
        let h = pow(sin(dLat / 2), 2) + cos(lat1) * cos(lat2) * pow(sin(dLon / 2), 2)
        return 2 * earthMiles * asin(min(1, sqrt(h)))
    }

    /// The nearest pack water within the radius, or nil - never a guess.
    static func nearestWater(in waters: [RiseWatchWater], lat: Double, lon: Double, maxMiles: Double = matchMiles) -> RiseWaterMatch? {
        var best: RiseWaterMatch?
        for water in waters {
            guard let waterLat = water.lat, let waterLon = water.lon else { continue }
            let distance = miles(fromLat: lat, fromLon: lon, toLat: waterLat, toLon: waterLon)
            guard distance <= maxMiles else { continue }
            if best == nil || distance < best!.miles {
                best = RiseWaterMatch(water: water, miles: distance)
            }
        }
        return best
    }
}

// MARK: - USGS on the Watch's own network

struct RiseUsgsReading: Equatable {
    var site: String
    var flow: String?
    var temp: String?
    var observedAt: Date
}

/// fetchUsgsReport() from the page, for a Watch that has its own Wi-Fi or
/// cellular. Same request, same rules: the no-data value (-999999) and
/// anything at or below -999 is no reading, a value older than 24 hours is
/// not current, and a response with nothing usable is no reading at all.
enum RiseUsgs {
    static let maxReadingAgeHours: Double = 24

    static func url(site: String) -> URL? {
        guard RiseWatchValidation.isValidSiteId(site) else { return nil }
        return URL(string: "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=\(site)&parameterCd=00060,00010&siteStatus=all")
    }

    private static func number(_ value: Any?) -> Double? {
        if let text = value as? String { return Double(text.trimmingCharacters(in: .whitespaces)) }
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        if let number = value as? NSNumber { return number.doubleValue }
        return nil
    }

    /// "4,160 cfs", as the page writes raw.toLocaleString("en-US").
    static func formatFlow(_ cfs: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 3
        formatter.roundingMode = .halfUp
        let text = formatter.string(from: NSNumber(value: cfs)) ?? String(cfs)
        return "\(text) cfs"
    }

    static func fahrenheit(celsius: Double) -> Int {
        Int((celsius * 9 / 5 + 32).rounded())
    }

    static func parse(_ data: Data, site: String, now: Date) -> RiseUsgsReading? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = root["value"] as? [String: Any],
              let series = value["timeSeries"] as? [[String: Any]] else {
            return nil
        }
        var flow: String?
        var temp: String?
        var observedAt: Date?
        for entry in series {
            let variable = entry["variable"] as? [String: Any]
            let code = ((variable?["variableCode"] as? [[String: Any]])?.first?["value"] as? String) ?? ""
            guard let blocks = entry["values"] as? [[String: Any]],
                  let points = blocks.first?["value"] as? [[String: Any]],
                  let latest = points.last,
                  let raw = number(latest["value"]), raw.isFinite else {
                continue
            }
            let noData = number(variable?["noDataValue"]) ?? -999_999
            if raw == noData || raw <= -999 { continue }
            guard let stamp = latest["dateTime"] as? String, let taken = RisePacific.parseISO(stamp) else { continue }
            if now.timeIntervalSince(taken) / 3600 > maxReadingAgeHours { continue }
            var kept = false
            if code == "00060" && raw >= 0 {
                flow = formatFlow(raw)
                kept = true
            }
            if code == "00010" && raw > -5 && raw < 40 {
                temp = "\(fahrenheit(celsius: raw)) F"
                kept = true
            }
            if kept {
                observedAt = min(observedAt ?? taken, taken)
            }
        }
        guard flow != nil || temp != nil, let observed = observedAt else { return nil }
        return RiseUsgsReading(site: site, flow: flow, temp: temp, observedAt: observed)
    }

    /// The Watch's own reading, in the pack's shape, so the same provenance
    /// rules age it. Only what USGS returned replaces anything.
    static func readings(_ reading: RiseUsgsReading, for water: RiseWatchWater) -> (flow: RiseWatchReading?, temp: RiseWatchReading?) {
        let stamp = RisePacific.isoString(reading.observedAt)
        let flow = reading.flow.map { RiseWatchReading(value: $0, source: .measured, observedAt: stamp, cachedAt: nil, reference: water.flow.reference) }
        let temp = reading.temp.map { RiseWatchReading(value: $0, source: .measured, observedAt: stamp, cachedAt: nil, reference: water.temp.reference) }
        return (flow, temp)
    }
}

// MARK: - A catch (Watch -> iPhone)

/// One catch as the journal stores it: exactly the fields Fish on! writes on
/// the phone (writeLogEntry / fishOnEntry), plus a stable watchId. The page
/// dedupes on watchId, so a catch delivered twice is logged once.
struct RiseWatchCatch: Codable, Equatable, Identifiable {
    var watchId: String
    var loggedAt: String
    var date: String
    var time: String
    var waterId: String
    var waterName: String
    var fly: String
    var fish: String
    var length: String
    var count: String
    var notes: String
    var flow: String
    var flowSource: String
    var temp: String
    var tempSource: String

    var id: String { watchId }

    var loggedDate: Date? { RisePacific.parseISO(loggedAt) }

    var isValid: Bool {
        RiseWatchValidation.isValidWatchId(watchId) && loggedDate != nil
    }

    /// Bounded plain text in every field; an unknown provenance word is
    /// replaced by unavailable and its value dropped, never guessed.
    func sanitized() -> RiseWatchCatch {
        var copy = self
        let clean = RiseWatchValidation.clean
        copy.date = clean(date, 20)
        copy.time = clean(time, 12)
        copy.waterId = clean(waterId, 64)
        copy.waterName = clean(waterName, 80)
        copy.fly = clean(fly, 60)
        copy.fish = clean(fish, 60)
        copy.length = clean(length, 6)
        copy.count = clean(count, 3)
        copy.notes = clean(notes, 200)
        copy.flow = clean(flow, 40)
        copy.temp = clean(temp, 40)
        if RiseProvenance(rawValue: flowSource) == nil {
            copy.flowSource = RiseProvenance.unavailable.rawValue
            copy.flow = ""
        }
        if RiseProvenance(rawValue: tempSource) == nil {
            copy.tempSource = RiseProvenance.unavailable.rawValue
            copy.temp = ""
        }
        return copy
    }

    /// A new catch on the Watch: Oregon date and time, the fly on screen, and
    /// each reading aged by RiseReadingRules at this moment. Species and
    /// length start blank - nothing the angler did not enter is filled in.
    static func make(
        watchId: String,
        water: RiseWatchWater,
        fly: String,
        flow: RiseWatchReading,
        temp: RiseWatchReading,
        packGeneratedAt: Date?,
        now: Date
    ) -> RiseWatchCatch {
        let flowNow = RiseReadingRules.stamp(flow, packGeneratedAt: packGeneratedAt, now: now)
        let tempNow = RiseReadingRules.stamp(temp, packGeneratedAt: packGeneratedAt, now: now)
        return RiseWatchCatch(
            watchId: watchId,
            loggedAt: RisePacific.isoString(now),
            date: RisePacific.dateLabel(now),
            time: RisePacific.timeLabel(now),
            waterId: water.id,
            waterName: water.name,
            fly: fly,
            fish: "",
            length: "",
            count: "1",
            notes: "",
            flow: flowNow.value,
            flowSource: flowNow.source.rawValue,
            temp: tempNow.value,
            tempSource: tempNow.source.rawValue
        )
    }

    /// 14 -> "14", 14.5 -> "14.5", 0 or less -> "" (not measured).
    static func lengthText(_ inches: Double) -> String {
        guard inches.isFinite, inches > 0 else { return "" }
        let rounded = (inches * 4).rounded() / 4
        if rounded == rounded.rounded() { return String(Int(rounded)) }
        var text = String(format: "%.2f", rounded)
        while text.hasSuffix("0") { text.removeLast() }
        return text
    }
}

// MARK: - The Watch's own queue

/// Where a Watch catch is on its way to the journal. Only ever moves forward,
/// except that a failed transfer goes back to queued to be sent again.
enum RiseCatchState: String, Codable, Comparable {
    /// Logged and on disk; inside its Undo window or having details added.
    case draft
    /// Sealed, waiting to be handed to WatchConnectivity.
    case queued
    /// Handed to transferUserInfo; the system is carrying it.
    case sent
    /// WatchConnectivity says the iPhone has it (in its pending file).
    case delivered
    /// The iPhone confirmed it is in the journal.
    case saved

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = (try? container.decode(String.self)) ?? ""
        // An unknown state is resent: the iPhone dedupes, a lost catch is worse.
        self = RiseCatchState(rawValue: raw) ?? .queued
    }

    private var rank: Int {
        switch self {
        case .draft: return 0
        case .queued: return 1
        case .sent: return 2
        case .delivered: return 3
        case .saved: return 4
        }
    }

    static func < (lhs: RiseCatchState, rhs: RiseCatchState) -> Bool {
        lhs.rank < rhs.rank
    }
}

struct RiseQueuedCatch: Codable, Equatable {
    var entry: RiseWatchCatch
    var state: RiseCatchState
}

/// The Watch's durable record of its catches. Written to a JSON file before
/// anything is sent, so a catch survives the app being killed, the battery
/// dying mid-transfer and the iPhone being at home.
struct RiseCatchQueue: Codable, Equatable {
    var items: [RiseQueuedCatch] = []

    func contains(_ watchId: String) -> Bool {
        items.contains { $0.entry.watchId == watchId }
    }

    func item(_ watchId: String) -> RiseQueuedCatch? {
        items.first { $0.entry.watchId == watchId }
    }

    /// Adds a catch once. A repeated id is refused, not duplicated.
    @discardableResult
    mutating func add(_ entry: RiseWatchCatch, state: RiseCatchState = .draft) -> Bool {
        guard entry.isValid, !contains(entry.watchId) else { return false }
        items.append(RiseQueuedCatch(entry: entry.sanitized(), state: state))
        return true
    }

    /// Undo. Only a draft can be taken back; once sealed it is on its way.
    @discardableResult
    mutating func removeDraft(_ watchId: String) -> Bool {
        guard let index = items.firstIndex(where: { $0.entry.watchId == watchId && $0.state == .draft }) else { return false }
        items.remove(at: index)
        return true
    }

    /// Length and species, while the catch is still a draft.
    @discardableResult
    mutating func editDraft(_ watchId: String, _ change: (inout RiseWatchCatch) -> Void) -> Bool {
        guard let index = items.firstIndex(where: { $0.entry.watchId == watchId && $0.state == .draft }) else { return false }
        var entry = items[index].entry
        change(&entry)
        entry.watchId = watchId
        items[index].entry = entry.sanitized()
        return true
    }

    /// Seals drafts (all of them, or the named ones) for sending.
    @discardableResult
    mutating func seal(_ ids: [String]? = nil) -> [String] {
        var sealed: [String] = []
        for index in items.indices where items[index].state == .draft {
            let watchId = items[index].entry.watchId
            if let ids = ids, !ids.contains(watchId) { continue }
            items[index].state = .queued
            sealed.append(watchId)
        }
        return sealed
    }

    /// Moves catches forward; never backwards.
    mutating func advance(_ ids: [String], to state: RiseCatchState) {
        let wanted = Set(ids)
        for index in items.indices where wanted.contains(items[index].entry.watchId) && items[index].state < state {
            items[index].state = state
        }
    }

    /// A transfer that failed, or that the system no longer holds, goes back
    /// to be sent again. Only a sent catch can be requeued.
    mutating func requeue(_ ids: [String]) {
        let wanted = Set(ids)
        for index in items.indices where wanted.contains(items[index].entry.watchId) && items[index].state == .sent {
            items[index].state = .queued
        }
    }

    /// Sent catches the system is no longer carrying and never reported
    /// delivered (the app was killed before it heard) are sent again.
    @discardableResult
    mutating func requeueSent(notIn outstanding: Set<String>) -> [String] {
        let lost = items.filter { $0.state == .sent && !outstanding.contains($0.entry.watchId) }.map { $0.entry.watchId }
        requeue(lost)
        return lost
    }

    var toSend: [RiseWatchCatch] {
        items.filter { $0.state == .queued }.map { $0.entry }
    }

    /// Not yet confirmed in the iPhone's journal.
    var unsyncedCount: Int {
        items.filter { $0.state != .saved }.count
    }

    /// On the iPhone, waiting for The Rise to be opened there.
    var waitingOnPhoneCount: Int {
        items.filter { $0.state == .delivered }.count
    }

    /// Fish logged on this Watch on today's Pacific date.
    func fishToday(now: Date) -> Int {
        let today = RisePacific.dayKey(now)
        return items.reduce(0) { total, item in
            guard let logged = item.entry.loggedDate, RisePacific.dayKey(logged) == today else { return total }
            return total + max(1, Int(item.entry.count) ?? 1)
        }
    }

    /// Forgets catches the journal already holds once they are a few days
    /// old. Nothing unconfirmed is ever pruned.
    mutating func prune(now: Date, keepDays: Int = 3) {
        let cutoff = now.addingTimeInterval(-Double(keepDays) * 86_400)
        items.removeAll { item in
            guard item.state == .saved, let logged = item.entry.loggedDate else { return false }
            return logged < cutoff
        }
    }
}

// MARK: - Files

enum RiseLoadResult<Value> {
    case missing
    case unreadable
    case loaded(Value)
}

/// Atomic JSON files. Missing and unreadable are different, as they are for
/// the journal on the page: an unreadable file is set aside, never
/// overwritten with an empty list.
enum RiseJSONFile {
    static func load<Value: Decodable>(_ type: Value.Type, from url: URL) -> RiseLoadResult<Value> {
        guard FileManager.default.fileExists(atPath: url.path) else { return .missing }
        guard let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(type, from: data) else {
            return .unreadable
        }
        return .loaded(value)
    }

    @discardableResult
    static func save<Value: Encodable>(_ value: Value, to url: URL) -> Bool {
        guard let data = try? JSONEncoder().encode(value) else { return false }
        return write(data, to: url)
    }

    @discardableResult
    static func write(_ data: Data, to url: URL) -> Bool {
        let directory = url.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        do {
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// Moves an unreadable file aside so a fresh one can be started without
    /// destroying what was there. Returns where it went.
    @discardableResult
    static func setAside(_ url: URL, now: Date = Date()) -> URL? {
        let target = url.deletingPathExtension()
            .appendingPathExtension("unreadable-\(Int(now.timeIntervalSince1970))")
            .appendingPathExtension(url.pathExtension)
        do {
            try FileManager.default.moveItem(at: url, to: target)
            return target
        } catch {
            return nil
        }
    }
}

extension RiseCatchQueue {
    /// The queue on disk. An unreadable file is set aside and an empty queue
    /// started; the set-aside copy is kept for support to recover.
    static func load(from url: URL) -> RiseCatchQueue {
        switch RiseJSONFile.load(RiseCatchQueue.self, from: url) {
        case .loaded(let queue):
            return queue
        case .missing:
            return RiseCatchQueue()
        case .unreadable:
            RiseJSONFile.setAside(url)
            return RiseCatchQueue()
        }
    }

    @discardableResult
    func save(to url: URL) -> Bool {
        RiseJSONFile.save(self, to: url)
    }
}

// MARK: - The iPhone's held catches

/// Catches the iPhone has received and not yet seen in the journal. Kept in
/// Application Support until the page acknowledges them.
enum RiseWatchInbox {
    /// Adds what arrived to what is held, once per watchId, oldest first.
    static func merged(_ pending: [RiseWatchCatch], with incoming: [RiseWatchCatch]) -> [RiseWatchCatch] {
        var seen = Set<String>()
        var result: [RiseWatchCatch] = []
        for entry in pending + incoming where entry.isValid && !seen.contains(entry.watchId) {
            seen.insert(entry.watchId)
            result.append(entry.sanitized())
        }
        return result.sorted { ($0.loggedDate ?? .distantPast) < ($1.loggedDate ?? .distantPast) }
    }

    static func removing(_ ids: [String], from pending: [RiseWatchCatch]) -> [RiseWatchCatch] {
        let done = Set(ids)
        return pending.filter { !done.contains($0.watchId) }
    }

    static func load(from url: URL) -> RiseLoadResult<[RiseWatchCatch]> {
        RiseJSONFile.load([RiseWatchCatch].self, from: url)
    }

    @discardableResult
    static func save(_ pending: [RiseWatchCatch], to url: URL) -> Bool {
        RiseJSONFile.save(pending, to: url)
    }
}

// MARK: - WatchConnectivity payloads

/// Property-list dictionaries for WCSession, built and read in one place.
/// The JSON travels as Data so the dictionaries stay plist-safe.
enum RiseWatchTransfer {
    static let kindKey = "kind"
    static let catchKind = "catch"
    static let savedKind = "catchesSaved"
    static let packKind = "pack"
    static let version = 1

    static func userInfo(for entry: RiseWatchCatch) -> [String: Any]? {
        guard entry.isValid, let data = try? JSONEncoder().encode(entry) else { return nil }
        return [kindKey: catchKind, "version": version, "watchId": entry.watchId, "catch": data]
    }

    static func catches(fromUserInfo info: [String: Any]) -> [RiseWatchCatch] {
        guard info[kindKey] as? String == catchKind,
              let data = info["catch"] as? Data,
              let entry = try? JSONDecoder().decode(RiseWatchCatch.self, from: data),
              entry.isValid else {
            return []
        }
        return [entry.sanitized()]
    }

    static func watchId(inUserInfo info: [String: Any]) -> String? {
        guard info[kindKey] as? String == catchKind, let identifier = info["watchId"] as? String,
              RiseWatchValidation.isValidWatchId(identifier) else { return nil }
        return identifier
    }

    static func savedAck(ids: [String]) -> [String: Any] {
        [kindKey: savedKind, "ids": ids.filter(RiseWatchValidation.isValidWatchId)]
    }

    static func savedIds(fromUserInfo info: [String: Any]) -> [String] {
        guard info[kindKey] as? String == savedKind else { return [] }
        return (info["ids"] as? [Any] ?? []).compactMap { $0 as? String }.filter(RiseWatchValidation.isValidWatchId)
    }

    /// The page's pack, validated and re-encoded, as an application context.
    /// Garbage from the page never reaches the Watch.
    static func applicationContext(packJSON: String) -> [String: Any]? {
        guard let data = packJSON.data(using: .utf8),
              let pack = RiseWatchPack.decode(data),
              let encoded = pack.encodedForTransfer() else {
            return nil
        }
        return [kindKey: packKind, "version": version, "pack": encoded]
    }

    /// The pack and the exact bytes to keep on disk.
    static func pack(fromApplicationContext context: [String: Any]) -> (pack: RiseWatchPack, data: Data)? {
        guard context[kindKey] as? String == packKind,
              let data = context["pack"] as? Data,
              let pack = RiseWatchPack.decode(data) else {
            return nil
        }
        return (pack, data)
    }

    /// The call into the page with every held catch. JSON is valid
    /// JavaScript, so the array is passed as a literal.
    static func pageScript(for catches: [RiseWatchCatch]) -> String? {
        guard !catches.isEmpty,
              let data = try? JSONEncoder().encode(catches),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return "window.riseWatchCatches && window.riseWatchCatches({\"catches\":\(json)});"
    }
}
