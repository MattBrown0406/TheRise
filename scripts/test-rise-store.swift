// Behaviour tests for RiseStore, the durable catch-journal storage, for
// RiseAlerts, the decisions behind alerts for saved waters, and for
// RiseWatchModels, everything the Apple Watch link decides: provenance at the
// moment of a catch, Oregon's clock, the catch queue, nearest water and USGS.
//
// RiseStore deliberately imports only Foundation, so it compiles and runs on
// any Swift toolchain rather than requiring Xcode and a device. The photo
// identifiers it handles come from the web layer, which makes the path
// validation security-relevant and worth testing directly.
//
// Run: scripts/test-rise-store.sh

import Foundation

var checks = 0
var failures = 0

func assert(_ condition: Bool, _ label: String) {
    checks += 1
    if condition {
        print("  ok   \(label)")
    } else {
        failures += 1
        print("  FAIL \(label)")
    }
}

func group(_ name: String) {
    print("\n\(name)")
}

group("Photo identifier validation")
assert(RiseStore.isValidPhotoIdentifier("catch-1750000000000-ab12cd"), "accepts a generated identifier")
assert(RiseStore.isValidPhotoIdentifier("abcXYZ_019-"), "accepts letters, digits, dash and underscore")
assert(!RiseStore.isValidPhotoIdentifier(""), "rejects an empty identifier")
assert(!RiseStore.isValidPhotoIdentifier("../../etc/passwd"), "rejects path traversal")
assert(!RiseStore.isValidPhotoIdentifier("catch/../../secret"), "rejects embedded traversal")
assert(!RiseStore.isValidPhotoIdentifier("catch.jpg"), "rejects a dot, which could alter the extension")
assert(!RiseStore.isValidPhotoIdentifier("catch id"), "rejects whitespace")
assert(!RiseStore.isValidPhotoIdentifier("catch\u{0000}id"), "rejects a null byte")
assert(!RiseStore.isValidPhotoIdentifier(String(repeating: "a", count: 129)), "rejects an over-long identifier")
assert(RiseStore.isValidPhotoIdentifier(String(repeating: "a", count: 128)), "accepts the maximum length")

group("Photo URLs stay inside the photos directory")
assert(RiseStore.photoURL(for: "../escape") == nil, "no URL is produced for a traversing identifier")
if let url = RiseStore.photoURL(for: "catch-abc") {
    assert(url.lastPathComponent == "catch-abc.jpg", "a valid identifier maps to a .jpg file")
    assert(url.deletingLastPathComponent().lastPathComponent == "CatchPhotos", "photos land in CatchPhotos")
    assert(url.path.contains("TheRise"), "photos land under the app's own directory")
} else {
    assert(false, "a valid identifier produces a URL")
}

group("Photo round trip")
// A one-pixel JPEG, base64-encoded exactly as the web layer sends it.
let pixelBase64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
let dataURL = "data:image/jpeg;base64,\(pixelBase64)"
let identifier = "catch-test-\(Int(Date().timeIntervalSince1970))"

RiseStore.savePhoto(identifier: identifier, dataURL: dataURL)
let loaded = RiseStore.loadPhoto(identifier: identifier)
assert(loaded != nil, "a saved photo can be read back")
assert(loaded?.starts(with: [0xFF, 0xD8, 0xFF]) == true, "the stored bytes are a real JPEG, not base64 text")
assert(loaded == Data(base64Encoded: pixelBase64), "the stored bytes match what was sent")

RiseStore.savePhoto(identifier: "../escape-attempt", dataURL: dataURL)
assert(RiseStore.loadPhoto(identifier: "../escape-attempt") == nil, "a traversing save writes nothing")

RiseStore.deletePhoto(identifier: identifier)
assert(RiseStore.loadPhoto(identifier: identifier) == nil, "a deleted photo is gone")

group("Malformed input is ignored, not crashed on")
RiseStore.savePhoto(identifier: "catch-malformed", dataURL: "not-a-data-url")
assert(RiseStore.loadPhoto(identifier: "catch-malformed") == nil, "a data URL with no comma is ignored")
RiseStore.savePhoto(identifier: "catch-badb64", dataURL: "data:image/jpeg;base64,!!!!not base64!!!!")
assert(RiseStore.loadPhoto(identifier: "catch-badb64") == nil, "undecodable base64 is ignored")
RiseStore.deletePhoto(identifier: "does-not-exist")
assert(true, "deleting a missing photo does not crash")

group("Catch log round trip")
let journal = #"[{"loggedAt":"2026-06-21T09:40:00.000Z","fish":"Redband Trout","length":"17"}]"#
RiseStore.saveLog(journal)
assert(RiseStore.loadLog() == journal, "the journal is written and read back verbatim")

let bigger = "[" + (0..<500).map { #"{"n":\#($0)}"# }.joined(separator: ",") + "]"
RiseStore.saveLog(bigger)
assert(RiseStore.loadLog() == bigger, "a 500-entry journal survives the round trip")
assert(RiseStore.loadLog()?.count ?? 0 > 4000, "the journal is not silently truncated")

group("CSV export")
// FileManager.temporaryDirectory can ignore TMPDIR on macOS. Pass the
// runner-owned directory explicitly rather than touching the developer's temp.
let exportDirectory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["RISE_STORE_ROOT"]!).appendingPathComponent("exports")
try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)
let csv = "\"Date\",\"Water\"\r\n\"Jun 21, 2026\",\"Crooked River\"\r\n"
if let url = RiseStore.exportURL(csv: csv, directory: exportDirectory) {
    assert(url.pathExtension == "csv", "the export is a .csv file")
    assert((try? String(contentsOf: url, encoding: .utf8)) == csv, "the export contains the CSV verbatim")
    try? FileManager.default.removeItem(at: url)
} else {
    assert(false, "the export produces a file URL")
}

group("Rejected photo payloads preserve an existing photo")
RiseStore.savePhoto(identifier: "catch-preserved", dataURL: dataURL)
for malformed in ["data:text/plain;base64,SGVsbG8=", "data:image/jpeg;base64,", "data:image/jpeg;base64,SGVsbG8=", "anything,\(pixelBase64)"] {
    RiseStore.savePhoto(identifier: "catch-preserved", dataURL: malformed)
    assert(RiseStore.loadPhoto(identifier: "catch-preserved") == Data(base64Encoded: pixelBase64), "invalid photo payload cannot overwrite existing JPEG: \(malformed.prefix(35))")
    RiseStore.savePhoto(identifier: "catch-invalid-new", dataURL: malformed)
    assert(RiseStore.loadPhoto(identifier: "catch-invalid-new") == nil, "invalid photo payload cannot create a new file")
    RiseStore.deletePhoto(identifier: "catch-invalid-new")
    // Reset for each independent corruption attempt.
    RiseStore.savePhoto(identifier: "catch-preserved", dataURL: dataURL)
}
RiseStore.deletePhoto(identifier: "catch-preserved")

group("Failed export does not advertise a nonexistent document")
// A directory at the file path deterministically forces the atomic write to
// fail (even as root). All paths are owned by the test runner.
let blockedExport = exportDirectory.appendingPathComponent("the-rise-catch-log.csv")
try FileManager.default.createDirectory(at: blockedExport, withIntermediateDirectories: false)
assert(RiseStore.exportURL(csv: csv, directory: exportDirectory) == nil, "an unsuccessful export returns nil rather than a shareable URL")
try FileManager.default.removeItem(at: blockedExport)

group("Photo disk-write acknowledgments")
assert(RiseStore.savePhoto(identifier: "ack-success", dataURL: dataURL), "a successful photo atomic write returns true")
assert(!RiseStore.savePhoto(identifier: "ack-invalid", dataURL: "data:image/jpeg;base64,SGVsbG8="), "a rejected photo returns false")
let blockedPhoto = RiseStore.photoURL(for: "ack-blocked")!
try FileManager.default.createDirectory(at: blockedPhoto, withIntermediateDirectories: false)
assert(!RiseStore.savePhoto(identifier: "ack-blocked", dataURL: dataURL), "an actual disk write failure returns false")
try FileManager.default.removeItem(at: blockedPhoto)
RiseStore.deletePhoto(identifier: "ack-success")

// MARK: - Alerts for saved waters (RiseAlerts)

func pacificDate(_ text: String) -> Date {
    RiseAlerts.parseUsgsDate(text)!
}

group("Alert rules from the web layer are validated")
assert(RiseAlerts.isValidWaterId("lower-deschutes"), "accepts a water slug")
assert(!RiseAlerts.isValidWaterId("../rules"), "rejects a traversing water id")
assert(!RiseAlerts.isValidWaterId("Lower Deschutes"), "rejects spaces and capitals")
assert(RiseAlerts.isValidSiteId("14103000"), "accepts an eight-digit USGS site")
assert(!RiseAlerts.isValidSiteId("1410300"), "rejects a seven-digit site")
assert(!RiseAlerts.isValidSiteId("14103000&parameterCd=00010"), "rejects a site that would rewrite the query")
assert(!RiseAlerts.isValidSiteId("１４１０３０００"), "rejects full-width digits")
let message: [String: Any] = ["action": "setRules", "rules": [
    ["waterId": "lower-deschutes", "waterName": "Lower Deschutes", "site": "14103000", "flow": ["min": 3500, "max": 5200], "greatDay": NSNull()],
    ["waterId": "metolius", "waterName": "Metolius", "site": "14091500", "flow": NSNull(), "greatDay": ["threshold": 8]],
    ["waterId": "crooked", "waterName": "Crooked River", "site": "14080500", "flow": ["min": 400, "max": 200]],
    ["waterId": "hosmer", "waterName": "Hosmer Lake", "site": "", "flow": ["min": 1, "max": 2]],
    ["waterId": "lower-deschutes", "waterName": "Duplicate", "site": "14103000", "flow": ["min": 1, "max": 2]],
    ["waterId": "../escape", "site": "14103000", "flow": ["min": 1, "max": 2]]
] as [[String: Any]]]
let parsedRules = RiseAlerts.rules(fromMessage: message)
assert(parsedRules.map { $0.waterId } == ["lower-deschutes", "metolius"], "only well-formed rules survive, one per water: \(parsedRules.map { $0.waterId })")
assert(parsedRules.first?.flow == RiseFlowRule(min: 3500, max: 5200), "the flow range is carried as sent")
assert(parsedRules.first?.greatDay == nil, "a null half is no rule")
assert(parsedRules.last?.greatDay == RiseGreatDayRule(threshold: 8), "a great-day threshold is carried")
assert(parsedRules.last?.flow == nil, "a water with no flow rule has none")

group("Alert rules round-trip through Application Support")
assert(RiseAlerts.saveRules(parsedRules), "the rules are written")
assert(RiseAlerts.loadRules() == parsedRules, "and read back unchanged")
RiseAlerts.saveRules([])
assert(RiseAlerts.loadRules().isEmpty, "an empty list clears them")

group("A USGS response is read the way the web layer reads it")
let usgsNow = pacificDate("2026-11-18T12:00:00.000-08:00")
func usgsBody(value: String, dateTime: String, code: String = "00060", noData: Double = -999999) -> Data {
    let json = """
    {"value":{"timeSeries":[{"variable":{"variableCode":[{"value":"\(code)"}],"noDataValue":\(noData)},
    "values":[{"value":[{"value":"4000","dateTime":"2026-11-18T10:00:00.000-08:00"},{"value":"\(value)","dateTime":"\(dateTime)"}]}]}]}}
    """
    return json.data(using: .utf8)!
}
let fresh = RiseAlerts.parseUsgsFlow(usgsBody(value: "4160", dateTime: "2026-11-18T11:45:00.000-08:00"), now: usgsNow)
assert(fresh?.cfs == 4160, "the latest discharge value is read")
assert(fresh?.observedAt == pacificDate("2026-11-18T11:45:00.000-08:00"), "with the time USGS measured it")
assert(RiseAlerts.parseUsgsFlow(usgsBody(value: "4160", dateTime: "2026-11-18T01:00:00.000-08:00"), now: usgsNow) == nil, "an eleven-hour-old reading is not the flow now")
assert(RiseAlerts.parseUsgsFlow(usgsBody(value: "-999999", dateTime: "2026-11-18T11:45:00.000-08:00"), now: usgsNow) == nil, "the no-data value is not a measurement")
assert(RiseAlerts.parseUsgsFlow(usgsBody(value: "52", dateTime: "2026-11-18T11:45:00.000-08:00", code: "00010"), now: usgsNow) == nil, "a temperature series is not discharge")
assert(RiseAlerts.parseUsgsFlow("not json".data(using: .utf8)!, now: usgsNow) == nil, "a garbage body is no reading")
assert(RiseAlerts.parseUsgsFlow(#"{"value":{"timeSeries":[]}}"#.data(using: .utf8)!, now: usgsNow) == nil, "an empty series is no reading")
assert(RiseAlerts.usgsURL(site: "14103000")?.absoluteString == "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=14103000&parameterCd=00060&siteStatus=all",
       "the request is the public USGS instantaneous-values URL")
assert(RiseAlerts.usgsURL(site: "bad") == nil, "an invalid site never becomes a URL")

group("Flow alerts fire on entering the range, at most once a day")
let range = RiseFlowRule(min: 3500, max: 5000)
let morning = pacificDate("2026-11-18T08:00:00.000-08:00")
let inRange = RiseFlowReading(cfs: 4200, observedAt: morning)
let tooHigh = RiseFlowReading(cfs: 6100, observedAt: morning)
let first = RiseAlerts.flowDecision(flow: range, reading: inRange, previous: nil, now: morning)
assert(first.notify, "a first check already in range alerts once")
let second = RiseAlerts.flowDecision(flow: range, reading: inRange, previous: first.state, now: morning.addingTimeInterval(3 * 3600))
assert(!second.notify, "staying in range does not alert again")
let left = RiseAlerts.flowDecision(flow: range, reading: tooHigh, previous: second.state, now: morning.addingTimeInterval(4 * 3600))
assert(!left.notify && left.state.lastInRange == false, "leaving the range is recorded quietly")
let back = RiseAlerts.flowDecision(flow: range, reading: inRange, previous: left.state, now: morning.addingTimeInterval(6 * 3600))
assert(!back.notify, "re-entering the same Pacific day does not alert twice")
let nextDay = RiseAlerts.flowDecision(flow: range, reading: tooHigh, previous: back.state, now: morning.addingTimeInterval(20 * 3600))
let nextDayBack = RiseAlerts.flowDecision(flow: range, reading: inRange, previous: nextDay.state, now: morning.addingTimeInterval(26 * 3600))
assert(nextDayBack.notify, "re-entering on a later day alerts again")
let outside = RiseAlerts.flowDecision(flow: range, reading: tooHigh, previous: nil, now: morning)
assert(!outside.notify, "a river outside the range never alerts")
let edge = RiseAlerts.flowDecision(flow: range, reading: RiseFlowReading(cfs: 5000, observedAt: morning), previous: nil, now: morning)
assert(edge.notify, "the range is inclusive")
assert(RiseAlerts.pacificDayKey(pacificDate("2026-11-19T07:30:00.000Z")) == "2026-11-18", "the alert day is the Pacific day, not UTC's")
assert(RiseAlerts.flowStateKey(waterId: "crooked", flow: RiseFlowRule(min: 200, max: 300)) != RiseAlerts.flowStateKey(waterId: "crooked", flow: RiseFlowRule(min: 200, max: 320)),
       "changing the range starts a fresh state")
let staleState = ["gone|1|2": RiseFlowAlertState(lastInRange: true, lastNotifiedDay: "2026-11-18"), "crooked|200|300": RiseFlowAlertState(lastInRange: false, lastNotifiedDay: nil)]
let liveRule = RiseAlertRule(waterId: "crooked", waterName: "Crooked River", site: "14080500", flow: RiseFlowRule(min: 200, max: 300), greatDay: nil)
assert(Array(RiseAlerts.prunedFlowState(staleState, rules: [liveRule]).keys) == ["crooked|200|300"], "state for a deleted rule is pruned")
assert(RiseAlerts.saveFlowState(staleState) && RiseAlerts.loadFlowState() == staleState, "flow state round-trips")
let flowNote = RiseAlerts.flowNotification(rule: liveRule, flow: liveRule.flow!, reading: RiseFlowReading(cfs: 4160, observedAt: morning))
assert(flowNote.identifier == "flow.crooked.2026-11-18", "a flow notification is named for its water and day")
assert(flowNote.body.contains("4,160 cfs") && flowNote.body.contains("8:00 AM") && flowNote.title.contains("Crooked River"), "and says what USGS measured, when")

group("Great-day alerts fire the evening before, about 6 PM Pacific")
assert(RiseAlerts.eveningBefore("2026-11-21") == pacificDate("2026-11-20T18:00:00.000-08:00"), "6 PM Pacific the day before, in standard time")
assert(RiseAlerts.eveningBefore("2026-07-04") == pacificDate("2026-07-03T18:00:00.000-07:00"), "and in daylight time")
assert(RiseAlerts.eveningBefore("2026-11-02") == pacificDate("2026-11-01T18:00:00.000-08:00"), "across the November clock change")
assert(RiseAlerts.eveningBefore("2026-02-30") == nil && RiseAlerts.eveningBefore("tomorrow") == nil, "a date that does not exist schedules nothing")
let planMessage: [String: Any] = ["action": "scheduleGreatDays", "waters": [[
    "waterId": "metolius", "waterName": "Metolius", "threshold": 8,
    "days": [
        ["date": "2026-11-19", "label": "Thu", "score": 8.4, "reason": "overcast, BWO season, light wind"],
        ["date": "2026-11-20", "label": "Fri", "score": 7.1, "reason": "sunny"],
        ["date": "2026-11-22", "label": "Sun", "score": 9.0, "reason": "cloudy"],
        ["date": "not-a-date", "score": 9.0],
        ["date": "2026-11-23", "score": 40]
    ] as [[String: Any]]
]] as [[String: Any]]]
let plans = RiseAlerts.greatDayPlans(fromMessage: planMessage)
assert(plans.count == 1 && plans[0].days.count == 3, "malformed days are dropped (\(plans.first?.days.count ?? -1))")
let afternoon = pacificDate("2026-11-18T15:00:00.000-08:00")
let scheduled = RiseAlerts.greatDayNotifications(plan: plans[0], threshold: 8, now: afternoon)
assert(scheduled.map { $0.identifier } == ["greatday.metolius.2026-11-19", "greatday.metolius.2026-11-22"], "only days at or above the threshold: \(scheduled.map { $0.identifier })")
assert(scheduled.first?.fireDate == pacificDate("2026-11-18T18:00:00.000-08:00"), "tomorrow's alert fires at 6 PM today")
assert(scheduled.first?.body.contains("8.4") == true && scheduled.first?.body.contains("BWO season") == true, "and carries the score and reason")
let evening = pacificDate("2026-11-18T19:00:00.000-08:00")
assert(RiseAlerts.greatDayNotifications(plan: plans[0], threshold: 8, now: evening).map { $0.identifier } == ["greatday.metolius.2026-11-22"],
       "an evening that has already passed is not scheduled")
assert(RiseAlerts.greatDayNotifications(plan: plans[0], threshold: 9.5, now: afternoon).isEmpty, "a threshold nothing reaches schedules nothing")
assert(scheduled.allSatisfy { $0.identifier.hasPrefix(RiseAlerts.greatDayPrefix(waterId: "metolius")) }, "every identifier carries the water's prefix, so a new plan replaces it")

// MARK: - Apple Watch (RiseWatchModels)

func iso(_ text: String) -> Date {
    RisePacific.parseISO(text)!
}

let watchRoot = URL(fileURLWithPath: ProcessInfo.processInfo.environment["RISE_STORE_ROOT"]!).appendingPathComponent("watch", isDirectory: true)

func packReading(_ value: String, _ source: RiseProvenance, observed: String? = nil, cached: String? = nil, reference: String? = nil) -> RiseWatchReading {
    RiseWatchReading(value: value, source: source, observedAt: observed, cachedAt: cached, reference: reference)
}

group("Watch: a reading is aged again at the moment of a catch, never upgraded")
let catchTime = iso("2026-11-18T20:00:00.000Z")
let packTime = iso("2026-11-18T14:00:00.000Z")
let twoHours = RiseReadingRules.stamp(packReading("4,160 cfs", .measured, observed: "2026-11-18T18:00:00.000Z", cached: "2026-11-18T18:10:00.000Z", reference: "4,000 cfs"), packGeneratedAt: packTime, now: catchTime)
assert(twoHours.source == .measured && twoHours.value == "4,160 cfs", "a two-hour-old measurement is still measured")
assert(RiseReadingRules.label(twoHours, now: catchTime) == "measured 2h ago", "and says how old it is (\(RiseReadingRules.label(twoHours, now: catchTime)))")
let thirteen = RiseReadingRules.stamp(packReading("4,160 cfs", .measured, observed: "2026-11-18T07:00:00.000Z", cached: "2026-11-18T07:05:00.000Z"), packGeneratedAt: packTime, now: catchTime)
assert(thirteen.source == .stale && thirteen.value == "4,160 cfs", "past the 12-hour fresh window it becomes stale")
assert(RiseReadingRules.label(thirteen, now: catchTime) == "measured 13h ago", "with its age (\(RiseReadingRules.label(thirteen, now: catchTime)))")
let cachedOlder = RiseReadingRules.stamp(packReading("53 F", .measured, observed: "2026-11-18T19:00:00.000Z", cached: "2026-11-18T06:00:00.000Z"), packGeneratedAt: packTime, now: catchTime)
assert(cachedOlder.source == .stale, "the older of the two times decides")
let exactlyTwelve = RiseReadingRules.stamp(packReading("53 F", .measured, observed: "2026-11-18T08:00:00.000Z"), packGeneratedAt: packTime, now: catchTime)
assert(exactlyTwelve.source == .stale, "twelve hours to the minute is no longer fresh, as on the page")
let staleFresh = RiseReadingRules.stamp(packReading("53 F", .stale, observed: "2026-11-18T19:30:00.000Z"), packGeneratedAt: packTime, now: catchTime)
assert(staleFresh.source == .stale, "a reading the phone called stale is never upgraded")
let referenceStamp = RiseReadingRules.stamp(packReading("235 cfs", .reference, reference: "235 cfs"), packGeneratedAt: catchTime, now: catchTime)
assert(referenceStamp.source == .reference && referenceStamp.takenAt == nil && RiseReadingRules.label(referenceStamp, now: catchTime) == "reference", "a reference value stays reference, however new the pack")
let unavailableStamp = RiseReadingRules.stamp(packReading("No live gauge", .unavailable), packGeneratedAt: packTime, now: catchTime)
assert(unavailableStamp.source == .unavailable && RiseReadingRules.label(unavailableStamp, now: catchTime) == "", "unavailable stays unavailable and prints no provenance")
let expiredStamp = RiseReadingRules.stamp(packReading("4,160 cfs", .measured, observed: "2026-11-10T12:00:00.000Z", reference: "4,000 cfs"), packGeneratedAt: packTime, now: catchTime)
assert(expiredStamp == RiseStampedReading(value: "4,000 cfs", source: .reference, takenAt: nil), "past seven days it falls back to the seasonal value, labelled reference")
let expiredNoReference = RiseReadingRules.stamp(packReading("4,160 cfs", .stale, observed: "2026-11-01T12:00:00.000Z", reference: ""), packGeneratedAt: packTime, now: catchTime)
assert(expiredNoReference.source == .unavailable && expiredNoReference.value == "", "or to nothing when there is no seasonal value")
let untimed = RiseReadingRules.stamp(packReading("4,160 cfs", .measured), packGeneratedAt: nil, now: catchTime)
assert(untimed.source == .stale && RiseReadingRules.label(untimed, now: catchTime) == "measured earlier", "a measurement with no time at all is not called current")
let packAnchored = RiseReadingRules.stamp(packReading("4,160 cfs", .measured), packGeneratedAt: iso("2026-11-18T19:00:00.000Z"), now: catchTime)
assert(packAnchored.source == .measured, "with only the pack's time, the pack's time is used")
let oddSource = try JSONDecoder().decode(RiseWatchReading.self, from: #"{"value":"4,160 cfs","source":"live!"}"#.data(using: .utf8)!)
assert(oddSource.source == .unavailable, "an unknown provenance word decodes as unavailable")

group("Watch: dates and times are Oregon's, written the way the journal writes them")
assert(RisePacific.dateLabel(iso("2026-06-21T18:00:00.000Z")) == "Jun 21, 2026" && RisePacific.timeLabel(iso("2026-06-21T18:00:00.000Z")) == "11:00 AM", "summer is Pacific daylight time")
assert(RisePacific.dateLabel(iso("2026-11-19T07:30:00.000Z")) == "Nov 18, 2026" && RisePacific.timeLabel(iso("2026-11-19T07:30:00.000Z")) == "11:30 PM", "a late-evening catch is filed under Oregon's date, not UTC's")
assert(RisePacific.timeLabel(iso("2026-03-08T09:59:00.000Z")) == "1:59 AM" && RisePacific.timeLabel(iso("2026-03-08T10:00:00.000Z")) == "3:00 AM", "the March clock change skips 2 AM")
assert(RisePacific.timeLabel(iso("2026-11-01T08:30:00.000Z")) == "1:30 AM" && RisePacific.timeLabel(iso("2026-11-01T09:30:00.000Z")) == "1:30 AM", "the November clock change repeats 1 AM")
assert(RisePacific.dayKey(iso("2026-11-01T09:30:00.000Z")) == "2026-11-01" && RisePacific.dayKey(iso("2026-11-02T07:59:00.000Z")) == "2026-11-01", "and the day key follows Oregon across it")
assert(RisePacific.timeLabel(iso("2026-07-04T19:05:00.000Z")) == "12:05 PM" && RisePacific.timeLabel(iso("2026-07-04T07:05:00.000Z")) == "12:05 AM", "noon and midnight read as the page reads them")
assert(RisePacific.dateLabel(iso("2026-09-03T18:00:00.000Z")) == "Sep 3, 2026", "a single-digit day is not padded")
assert(RisePacific.isoString(iso("2026-11-18T16:05:00Z")) == "2026-11-18T16:05:00.000Z", "loggedAt is written like toISOString")
assert(RisePacific.asOfLabel(iso("2026-11-18T14:40:00.000Z"), now: catchTime) == "as of 6:40 AM", "a pack from today says when")
assert(RisePacific.asOfLabel(iso("2026-11-17T02:40:00.000Z"), now: catchTime) == "as of Mon 6:40 PM", "an older pack says which day")
assert(RisePacific.ageLabel(hours: 0.4) == "just now" && RisePacific.ageLabel(hours: 26) == "1 day ago", "ages read like the page's")

group("Watch: the prime window counts down on Oregon's clock")
let eveningWindow = RiseWatchWindow(startHour: 18, endHour: 21)
let beforeWindow = RisePrimeWindow.status(eveningWindow, now: iso("2026-06-21T23:20:00Z"))
assert(beforeWindow.state == .before && beforeWindow.text == "Prime window starts in 1h 40m", "before the window (\(beforeWindow.text))")
let duringWindow = RisePrimeWindow.status(eveningWindow, now: iso("2026-06-22T02:40:00Z"))
assert(duringWindow.state == .during && duringWindow.text == "Prime window ends in 1h 20m", "inside the window (\(duringWindow.text))")
assert(RisePrimeWindow.status(eveningWindow, now: iso("2026-06-22T04:30:00Z")).state == .after, "after the window")
assert(RisePrimeWindow.status(eveningWindow, now: iso("2026-06-22T03:59:30Z")).text == "Prime window ends in 1m", "the last seconds read as a minute, never zero")
assert(RisePrimeWindow.status(RiseWatchWindow(startHour: 11, endHour: 15), now: iso("2026-12-01T18:00:00Z")).range == "11 AM-3 PM Pacific", "the range is printed on Oregon's clock")
assert(RisePrimeWindow.status(nil, now: catchTime).state == .unknown, "a wind-decided window says so instead of counting down")

group("Watch: which water am I on?")
func packWater(_ id: String, lat: Double?, lon: Double?) -> RiseWatchWater {
    RiseWatchWater(id: id, name: id, type: "River", home: false, saved: true, topPick: false, lat: lat, lon: lon, usgsSite: nil, score: 7, scoreSource: "Live-adjusted score",
                   primeWindow: nil, flow: .none, temp: .none, flies: [], hatches: [], planner: nil)
}
let packWaters = [packWater("metolius", lat: 44.55, lon: -121.63), packWater("crooked", lat: 44.12, lon: -120.79), packWater("unmapped", lat: nil, lon: nil)]
let nearMetolius = RiseWatchGeo.nearestWater(in: packWaters, lat: 44.554, lon: -121.626)
assert(nearMetolius?.water.id == "metolius" && (nearMetolius?.miles ?? 9) < 0.5, "a fix beside a water picks it")
assert(RiseWatchGeo.nearestWater(in: packWaters, lat: 44.55 + 0.025, lon: -121.63)?.water.id == "metolius", "1.7 miles away is inside two miles")
assert(RiseWatchGeo.nearestWater(in: packWaters, lat: 44.55 + 0.05, lon: -121.63) == nil, "3.5 miles away matches nothing")
assert(abs(RiseWatchGeo.miles(fromLat: 44.55, fromLon: -121.63, toLat: 44.12, toLon: -120.79) - 51.05) < 0.05, "distances agree with milesBetween() on the page")
assert(RiseWatchGeo.nearestWater(in: [packWater("a", lat: 44.0, lon: -121.0), packWater("b", lat: 44.01, lon: -121.0)], lat: 44.008, lon: -121.0)?.water.id == "b", "the nearer of two waters wins")
assert(RiseWatchGeo.nearestWater(in: [packWater("unmapped", lat: nil, lon: nil)], lat: 44.0, lon: -121.0) == nil, "a water with no coordinates is never matched")

group("Watch: USGS on the Watch's own network, read exactly as the page reads it")
let watchNow = iso("2026-11-18T20:00:00.000Z")
func usgsSeries(_ code: String, _ value: String, _ dateTime: String, noData: String = "-999999.0") -> String {
    #"{"variable":{"variableCode":[{"value":"\#(code)"}],"noDataValue":\#(noData)},"values":[{"value":[{"value":"1","dateTime":"2026-11-18T00:00:00.000-08:00"},{"value":"\#(value)","dateTime":"\#(dateTime)"}]}]}"#
}
func usgsResponse(_ series: [String]) -> Data {
    #"{"value":{"timeSeries":[\#(series.joined(separator: ","))]}}"#.data(using: .utf8)!
}
let bothReadings = RiseUsgs.parse(usgsResponse([usgsSeries("00060", "4160", "2026-11-18T11:45:00.000-08:00"), usgsSeries("00010", "11.5", "2026-11-18T11:30:00.000-08:00")]), site: "14103000", now: watchNow)
assert(bothReadings?.flow == "4,160 cfs" && bothReadings?.temp == "53 F", "flow and temperature are read and formatted as the page formats them (\(String(describing: bothReadings)))")
assert(bothReadings?.observedAt == iso("2026-11-18T11:30:00.000-08:00"), "the reading is as old as its older half")
let noDataFlow = RiseUsgs.parse(usgsResponse([usgsSeries("00060", "-999999", "2026-11-18T11:45:00.000-08:00"), usgsSeries("00010", "11.5", "2026-11-18T11:30:00.000-08:00")]), site: "14103000", now: watchNow)
assert(noDataFlow?.flow == nil && noDataFlow?.temp == "53 F", "the no-data value is not a flow, and the other half survives")
let iced = RiseUsgs.parse(usgsResponse([usgsSeries("00060", "-999999", "2026-11-18T11:45:00.000-08:00"), usgsSeries("00010", "-999999", "2026-11-18T11:30:00.000-08:00")]), site: "14103000", now: watchNow)
assert(iced == nil, "a gauge reporting no data everywhere is no reading at all")
let oldReading = RiseUsgs.parse(usgsResponse([usgsSeries("00060", "4160", "2026-11-17T10:00:00.000-08:00")]), site: "14103000", now: watchNow)
assert(oldReading == nil, "a reading older than 24 hours is not current")
let dayOld = RiseUsgs.parse(usgsResponse([usgsSeries("00060", "4160", "2026-11-17T13:00:00.000-08:00")]), site: "14103000", now: watchNow)
assert(dayOld?.flow == "4,160 cfs", "23 hours old is still read, and then aged as stale by the provenance rules")
let warmGlitch = RiseUsgs.parse(usgsResponse([usgsSeries("00010", "45", "2026-11-18T11:30:00.000-08:00")]), site: "14103000", now: watchNow)
assert(warmGlitch == nil, "a water temperature outside -5 to 40 C is dropped")
assert(RiseUsgs.parse(usgsResponse([usgsSeries("00060", "235.5", "2026-11-18T11:45:00.000-08:00")]), site: "14080500", now: watchNow)?.flow == "235.5 cfs", "a fractional flow keeps its fraction")
assert(RiseUsgs.parse("<html>busy</html>".data(using: .utf8)!, site: "14103000", now: watchNow) == nil, "a garbage body is no reading")
assert(RiseUsgs.url(site: "14103000")?.absoluteString == "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=14103000&parameterCd=00060,00010&siteStatus=all", "the request is the page's own")
assert(RiseUsgs.url(site: "14103000&x=1") == nil, "an invalid site never becomes a URL")
if let bothReadings = bothReadings {
    let gauged = RiseWatchWater(id: "lower-deschutes", name: "Lower Deschutes", type: "River", home: true, saved: false, topPick: false, lat: 45.21, lon: -121.05,
                                usgsSite: "14103000", score: 7.5, scoreSource: "Cached live score", primeWindow: nil,
                                flow: packReading("4,000 cfs", .stale, observed: "2026-11-17T10:00:00.000Z", reference: "4,160 cfs"), temp: packReading("52 F", .reference, reference: "52 F"),
                                flies: [], hatches: [], planner: nil)
    let own = RiseUsgs.readings(bothReadings, for: gauged)
    assert(own.flow?.source == .measured && own.flow?.reference == "4,160 cfs", "the Watch's own reading is measured, and keeps the seasonal fallback")
    let ownFlowNow = RiseReadingRules.stamp(own.flow!, packGeneratedAt: nil, now: watchNow)
    assert(ownFlowNow.source == .measured, "and is current when the catch is logged")
}

group("Watch: a catch carries the journal's own fields")
let crookedPack = RiseWatchWater(id: "crooked", name: "Crooked River", type: "River", home: true, saved: true, topPick: false, lat: 44.12, lon: -120.79,
                                 usgsSite: "14080500", score: 8.1, scoreSource: "Live-adjusted score", primeWindow: RiseWatchWindow(startHour: 11, endHour: 15),
                                 flow: packReading("240 cfs", .measured, observed: "2026-11-18T05:00:00.000Z", cached: "2026-11-18T05:10:00.000Z", reference: "235 cfs"),
                                 temp: packReading("47 F", .reference, reference: "47 F"), flies: ["Zebra Midge #20"], hatches: ["Midge"], planner: nil)
let made = RiseWatchCatch.make(watchId: "6F1C2A3B-0000-4000-8000-00000000AAAA", water: crookedPack, fly: "Zebra Midge #20", flow: crookedPack.flow, temp: crookedPack.temp,
                               packGeneratedAt: packTime, now: iso("2026-11-18T19:05:00.000Z"))
assert(made.date == "Nov 18, 2026" && made.time == "11:05 AM" && made.loggedAt == "2026-11-18T19:05:00.000Z", "dated on Oregon's clock")
assert(made.flowSource == "stale" && made.flow == "240 cfs", "a pack reading 14 hours old is stamped stale")
assert(made.tempSource == "reference" && made.temp == "47 F", "a reference value is stamped reference")
assert(made.fish == "" && made.length == "" && made.count == "1" && made.notes == "", "species and length are left for the angler, never guessed")
assert(RiseWatchCatch.lengthText(14) == "14" && RiseWatchCatch.lengthText(14.5) == "14.5" && RiseWatchCatch.lengthText(0) == "", "length is written as typed on the phone")
let encodedCatch = String(data: try JSONEncoder().encode(made), encoding: .utf8)!
for key in ["watchId", "loggedAt", "date", "time", "waterId", "waterName", "fly", "fish", "length", "count", "notes", "flow", "flowSource", "temp", "tempSource"] {
    assert(encodedCatch.contains("\"\(key)\""), "the catch JSON carries \(key)")
}

group("Watch: ids dedupe everywhere a catch can repeat")
var dedupeQueue = RiseCatchQueue()
assert(dedupeQueue.add(made), "a catch is queued")
assert(!dedupeQueue.add(made), "the same id is refused, not duplicated")
var badId = made
badId.watchId = "../../x"
assert(!dedupeQueue.add(badId), "a malformed id is refused")
let earlierCatch = RiseWatchCatch.make(watchId: "6F1C2A3B-0000-4000-8000-00000000BBBB", water: crookedPack, fly: "", flow: crookedPack.flow, temp: crookedPack.temp,
                                 packGeneratedAt: packTime, now: iso("2026-11-18T18:00:00.000Z"))
let inbox = RiseWatchInbox.merged([made], with: [earlierCatch, made, earlierCatch])
assert(inbox.map { $0.watchId } == [earlierCatch.watchId, made.watchId], "the iPhone holds each catch once, oldest first")
assert(RiseWatchInbox.removing([made.watchId], from: inbox).map { $0.watchId } == [earlierCatch.watchId], "and lets go of exactly the acknowledged ones")
let catchInfo = RiseWatchTransfer.userInfo(for: made)!
assert(RiseWatchTransfer.catches(fromUserInfo: catchInfo) == [made], "a catch survives the userInfo round trip")
assert(RiseWatchTransfer.watchId(inUserInfo: catchInfo) == made.watchId, "and names its id for the outstanding-transfer check")
assert(RiseWatchTransfer.catches(fromUserInfo: ["kind": "catch", "catch": "nope".data(using: .utf8)!]).isEmpty, "a garbled transfer is no catch")
assert(RiseWatchTransfer.savedIds(fromUserInfo: RiseWatchTransfer.savedAck(ids: [made.watchId, "bad id"])) == [made.watchId], "the saved acknowledgement round-trips, valid ids only")
let pageCall = RiseWatchTransfer.pageScript(for: inbox)!
assert(pageCall.hasPrefix("window.riseWatchCatches && window.riseWatchCatches({\"catches\":[") && pageCall.contains(made.watchId), "held catches reach the page as one call")
assert(RiseWatchTransfer.pageScript(for: []) == nil, "and nothing is called with nothing to give")

group("Watch: the queue moves forward, survives a restart, and keeps what is unconfirmed")
var watchQueue = RiseCatchQueue()
watchQueue.add(made)
watchQueue.add(earlierCatch)
assert(watchQueue.editDraft(made.watchId) { entry in entry.fish = "Redband Trout"; entry.length = "15.5"; entry.watchId = "changed-id-00" }, "a draft takes length and species")
assert(watchQueue.item(made.watchId)?.entry.fish == "Redband Trout" && watchQueue.item("changed-id-00") == nil, "and keeps its id")
assert(watchQueue.seal([made.watchId]) == [made.watchId] && watchQueue.toSend.map { $0.watchId } == [made.watchId], "sealing one queues only that one")
assert(!watchQueue.editDraft(made.watchId) { $0.fish = "Bull Trout" } && !watchQueue.removeDraft(made.watchId), "a sealed catch can no longer be edited or undone")
assert(watchQueue.removeDraft(earlierCatch.watchId) && !watchQueue.contains(earlierCatch.watchId), "Undo removes a draft")
watchQueue.add(earlierCatch)
watchQueue.seal()
watchQueue.advance([made.watchId, earlierCatch.watchId], to: .sent)
watchQueue.advance([made.watchId], to: .delivered)
watchQueue.advance([made.watchId], to: .sent)
assert(watchQueue.item(made.watchId)?.state == .delivered, "a state never moves backwards")
assert(watchQueue.requeueSent(notIn: []) == [earlierCatch.watchId] && watchQueue.item(earlierCatch.watchId)?.state == .queued, "a sent catch the system no longer carries is sent again")
watchQueue.advance([earlierCatch.watchId], to: .sent)
assert(watchQueue.requeueSent(notIn: [earlierCatch.watchId]).isEmpty, "one it still carries is left alone")
assert(watchQueue.unsyncedCount == 2 && watchQueue.waitingOnPhoneCount == 1, "unsynced counts everything not yet in the journal")
assert(watchQueue.fishToday(now: iso("2026-11-19T06:00:00.000Z")) == 2 && watchQueue.fishToday(now: iso("2026-11-19T09:00:00.000Z")) == 0, "today is Oregon's today")
let queueURL = watchRoot.appendingPathComponent("catch-watchQueue.json")
assert(watchQueue.save(to: queueURL), "the queue is written")
assert(RiseCatchQueue.load(from: queueURL) == watchQueue, "and read back unchanged")
watchQueue.advance([made.watchId, earlierCatch.watchId], to: .saved)
watchQueue.prune(now: iso("2026-11-20T20:00:00.000Z"))
assert(watchQueue.items.count == 2, "a saved catch is kept for a few days")
var unconfirmed = watchQueue
unconfirmed.add(RiseWatchCatch.make(watchId: "6F1C2A3B-0000-4000-8000-00000000CCCC", water: crookedPack, fly: "", flow: .none, temp: .none, packGeneratedAt: nil, now: iso("2026-11-01T18:00:00.000Z")), state: .queued)
unconfirmed.prune(now: iso("2026-11-30T20:00:00.000Z"))
assert(unconfirmed.items.map { $0.entry.watchId } == ["6F1C2A3B-0000-4000-8000-00000000CCCC"], "old confirmed catches are pruned, an unconfirmed one never is")
try "{ not json".data(using: .utf8)!.write(to: queueURL)
assert(RiseCatchQueue.load(from: queueURL)?.items.isEmpty == true, "an unreadable queue file starts a fresh queue")
let setAside = (try? FileManager.default.contentsOfDirectory(atPath: watchRoot.path)) ?? []
assert(setAside.contains { $0.hasPrefix("catch-watchQueue.unreadable-") }, "after setting the unreadable file aside, not overwriting it (\(setAside))")
assert(RiseCatchQueue.load(from: watchRoot.appendingPathComponent("missing.json"))?.items.isEmpty == true, "a missing file is an empty queue")
let stateJSON = #"{"items":[{"entry":\#(encodedCatch),"state":"teleported"}]}"#
let oddState = try JSONDecoder().decode(RiseCatchQueue.self, from: stateJSON.data(using: .utf8)!)
assert(oddState.items.first?.state == .queued, "an unknown state is resent rather than lost")
let inboxURL = watchRoot.appendingPathComponent("watch-pending-catches.json")
assert(RiseWatchInbox.save(inbox, to: inboxURL), "the iPhone's held catches are written")
if case .loaded(let held) = RiseWatchInbox.load(from: inboxURL) {
    assert(held == inbox, "and read back unchanged")
} else {
    assert(false, "and read back")
}

group("Watch: the trip pack the page sends is decoded, validated and kept small")
let pageJSON = """
{"version":1,"generatedAt":"2026-11-18T14:00:00.000Z","pacificDate":"2026-11-18","homeWaterId":"crooked",
 "species":["Redband Trout","Bull Trout"],
 "waters":[
  {"id":"crooked","name":"Crooked River","type":"River","home":true,"saved":true,"topPick":false,"lat":44.12,"lon":-120.79,"usgsSite":"14080500",
   "score":8.1,"scoreSource":"Live-adjusted score","primeWindow":{"startHour":11,"endHour":15},
   "flow":{"value":"240 cfs","source":"measured","observedAt":"2026-11-18T13:00:00.000Z","cachedAt":"2026-11-18T13:10:00.000Z","reference":"235 cfs"},
   "temp":{"value":"47 F","source":"reference","observedAt":null,"cachedAt":null,"reference":"47 F"},
   "flies":["Zebra Midge #20","BWO Emerger #18"],"hatches":["Midge","BWO"],
   "planner":{"fetchedAt":"2026-11-18T13:00:00.000Z","days":[{"date":"2026-11-19","label":"Thu","score":8.4,"reason":"cloudy"},{"date":"2026-11-20","label":"Fri","score":null,"reason":"Typically snowed in"}],"best":{"date":"2026-11-19","label":"Thu","score":8.4,"reason":"cloudy"}}},
  {"id":"hosmer","name":"Hosmer Lake","type":"Lake","home":false,"saved":true,"topPick":true,"lat":43.96,"lon":-121.79,"usgsSite":null,
   "score":6.2,"scoreSource":"Seasonal reference score - no live feed","primeWindow":null,
   "flow":{"value":"Stillwater","source":"reference","observedAt":null,"cachedAt":null,"reference":"Stillwater"},
   "temp":{"value":"48 F","source":"reference","observedAt":null,"cachedAt":null,"reference":"48 F"},
   "flies":[],"hatches":[],"planner":null},
  {"id":"../escape","name":"Bad","type":"River"},
  {"id":"crooked","name":"Duplicate","type":"River"}
 ]}
"""
let decodedPack = RiseWatchPack.decode(pageJSON.data(using: .utf8)!)
assert(decodedPack?.waters.map { $0.id } == ["crooked", "hosmer"], "the page's pack decodes; a bad or repeated water is dropped (\(decodedPack?.waters.map { $0.id } ?? []))")
assert(decodedPack?.waters.first?.planner?.days.last?.score == nil && decodedPack?.waters.first?.planner?.best?.score == 8.4, "a snowed-in day stays unscored")
assert(decodedPack?.waters.last?.primeWindow == nil && decodedPack?.waters.last?.usgsSite == nil, "a lake's wind-decided window and missing gauge survive as nil")
assert(RiseWatchPack.decode(#"{"version":9,"generatedAt":"2026-11-18T14:00:00.000Z","waters":[]}"#.data(using: .utf8)!) == nil, "a pack from a newer, unknown version is refused")
assert(RiseWatchPack.decode("nonsense".data(using: .utf8)!) == nil, "garbage is no pack")
let packContext = RiseWatchTransfer.applicationContext(packJSON: pageJSON)
assert(packContext?["kind"] as? String == "pack" && (packContext?["pack"] as? Data) != nil, "the iPhone sends it as an application context")
assert(RiseWatchTransfer.pack(fromApplicationContext: packContext ?? [:])?.pack == decodedPack, "and the Watch reads back the same pack")
assert(RiseWatchTransfer.applicationContext(packJSON: "{}") == nil, "garbage from the page never reaches the Watch")
if var big = decodedPack {
    let template = big.waters[0]
    big.waters = (0..<12).map { index -> RiseWatchWater in
        var copy = template
        copy.id = "water-\(index)"
        copy.planner = RiseWatchPlanner(fetchedAt: nil, days: (0..<7).map { _ in RiseWatchPlannerDay(date: "2026-11-19", label: "Thu", score: 8, reason: String(repeating: "x", count: 1200)) }, best: nil)
        return copy
    }
    let trimmed = big.encodedForTransfer()
    let trimmedPack = trimmed.flatMap { RiseWatchPack.decode($0) }
    assert((trimmed?.count ?? .max) <= RiseWatchPack.maxEncodedBytes && trimmedPack?.waters.first?.id == "water-0", "an oversized pack is trimmed to fit, first water kept")
    assert(trimmedPack?.waters.allSatisfy { $0.planner == nil } == true, "planner days are the first thing dropped")
}

group("Watch: a file that failed to READ is not a file that failed to DECODE")
// A directory where the file should be: it exists, and reading it fails.
let unreadableDir = watchRoot.appendingPathComponent("locked-queue.json", isDirectory: true)
try? FileManager.default.createDirectory(at: unreadableDir, withIntermediateDirectories: true)
if case .readFailed = RiseJSONFile.load(RiseCatchQueue.self, from: unreadableDir) {
    assert(true, "a file that cannot be read is readFailed")
} else {
    assert(false, "a file that cannot be read is readFailed")
}
assert(RiseCatchQueue.load(from: unreadableDir) == nil, "the Watch queue reports it as nil, so nothing is written over it")
let afterReadFailure = (try? FileManager.default.contentsOfDirectory(atPath: watchRoot.path)) ?? []
assert(afterReadFailure.contains("locked-queue.json") && !afterReadFailure.contains { $0.hasPrefix("locked-queue.unreadable-") },
       "and it is never set aside (\(afterReadFailure))")
if case .readFailed = RiseWatchInbox.load(from: unreadableDir) {
    assert(true, "the iPhone's held-catch file is told apart the same way")
} else {
    assert(false, "the iPhone's held-catch file is told apart the same way")
}
let damagedInbox = watchRoot.appendingPathComponent("damaged-inbox.json")
try "[{ not json".data(using: .utf8)!.write(to: damagedInbox)
if case .unreadable = RiseWatchInbox.load(from: damagedInbox) {
    assert(true, "a file that reads but does not decode is unreadable (damaged)")
} else {
    assert(false, "a file that reads but does not decode is unreadable (damaged)")
}

group("Watch: the iPhone remembers which catches the journal took")
let ackA = "6F1C2A3B-0000-4000-8000-0000000AC001"
let ackB = "6F1C2A3B-0000-4000-8000-0000000AC002"
var ackLog = RiseWatchAckLog()
ackLog.record([ackA, ackB, ackA, "bad id"])
assert(ackLog.acked == [ackA, ackB] && ackLog.unsent == [ackA, ackB], "acknowledged ids are recorded once each, valid ids only (\(ackLog.acked))")
assert(ackLog.isAcked(ackA) && !ackLog.isAcked(made.watchId), "and can be looked up")
ackLog.markSent([ackA])
assert(ackLog.unsent == [ackB] && ackLog.isAcked(ackA), "an acknowledgement handed to the system is no longer owed, but still remembered")
ackLog.record([ackA])
assert(ackLog.acked == [ackA, ackB] && ackLog.unsent == [ackB, ackA], "acknowledging again owes the Watch another acknowledgement")
var bigLog = RiseWatchAckLog()
bigLog.record((0..<(RiseWatchAckLog.maxIds + 5)).map { String(format: "6F1C2A3B-0000-4000-8000-%012ld", $0) })
assert(bigLog.acked.count == RiseWatchAckLog.maxIds && bigLog.acked.first == String(format: "6F1C2A3B-0000-4000-8000-%012ld", 5),
       "the list is bounded; the oldest ids go first (\(bigLog.acked.count))")
let mergedLog = RiseWatchAckLog(acked: [ackA], unsent: []).merged(with: RiseWatchAckLog(acked: [ackB, ackA], unsent: [ackB]))
assert(mergedLog.acked == [ackA, ackB] && mergedLog.unsent == [ackB], "a log recorded while the file could not be read merges into it, once each")
let ackURL = watchRoot.appendingPathComponent("watch-acked-ids.json")
assert(ackLog.save(to: ackURL), "the log is written")
if case .loaded(let readLog) = RiseWatchAckLog.load(from: ackURL) {
    assert(readLog == ackLog, "and read back unchanged")
} else {
    assert(false, "and read back")
}
let partialLog = try JSONDecoder().decode(RiseWatchAckLog.self, from: #"{"acked":["\#(ackA)","../x"]}"#.data(using: .utf8)!)
assert(partialLog.acked == [ackA] && partialLog.unsent.isEmpty, "a log with a missing field or a bad id still decodes")
let acks = RiseWatchTransfer.savedAcks(ids: (0..<450).map { String(format: "6F1C2A3B-0000-4000-8000-%012ld", $0) } + ["bad id"])
assert(acks.count == 3 && acks.map { RiseWatchTransfer.savedIds(fromUserInfo: $0).count } == [200, 200, 50], "a long backlog goes in bounded transfers")
assert(RiseWatchTransfer.savedAcks(ids: []).isEmpty, "and nothing is sent for nothing")

group("Watch: an acknowledged catch that arrives again is acknowledged, never held again")
var deletedOnPhone = made
deletedOnPhone.watchId = ackA
let arrivals = RiseWatchInbox.split([deletedOnPhone, earlierCatch, deletedOnPhone], acked: ackLog)
assert(arrivals.fresh.map { $0.watchId } == [earlierCatch.watchId], "a new catch is held for the page")
assert(arrivals.alreadySaved == [ackA], "an acknowledged one is only acknowledged again, once")
assert(RiseWatchInbox.split([earlierCatch], acked: RiseWatchAckLog()).alreadySaved.isEmpty, "with nothing acknowledged everything is held")

group("Watch: the requeue rules")
var requeueQueue = RiseCatchQueue()
let deliveredCatch = RiseWatchCatch.make(watchId: "6F1C2A3B-0000-4000-8000-0000000DE001", water: crookedPack, fly: "", flow: .none, temp: .none, packGeneratedAt: nil, now: iso("2026-11-18T18:00:00.000Z"))
let freshDelivered = RiseWatchCatch.make(watchId: "6F1C2A3B-0000-4000-8000-0000000DE002", water: crookedPack, fly: "", flow: .none, temp: .none, packGeneratedAt: nil, now: iso("2026-11-18T18:00:00.000Z"))
let sentCatch = RiseWatchCatch.make(watchId: "6F1C2A3B-0000-4000-8000-0000000DE003", water: crookedPack, fly: "", flow: .none, temp: .none, packGeneratedAt: nil, now: iso("2026-11-18T18:00:00.000Z"))
requeueQueue.add(deliveredCatch, state: .sent)
requeueQueue.add(freshDelivered, state: .sent)
requeueQueue.add(sentCatch, state: .sent)
requeueQueue.advance([deliveredCatch.watchId], to: .delivered, now: iso("2026-11-18T19:00:00.000Z"))
requeueQueue.advance([freshDelivered.watchId], to: .delivered, now: iso("2026-11-19T18:00:00.000Z"))
assert(requeueQueue.item(deliveredCatch.watchId)?.deliveredAt == "2026-11-18T19:00:00.000Z", "delivery is time-stamped")
let day = 24.0 * 3600
assert(requeueQueue.requeueDelivered(olderThan: day, now: iso("2026-11-19T18:59:00.000Z")).isEmpty, "a delivered catch waits a day for the iPhone to confirm it")
assert(requeueQueue.requeueDelivered(olderThan: day, now: iso("2026-11-19T19:00:00.000Z")) == [deliveredCatch.watchId], "then it is sent again")
assert(requeueQueue.item(deliveredCatch.watchId)?.state == .queued && requeueQueue.item(deliveredCatch.watchId)?.deliveredAt == nil, "back in the queue, with no delivery time")
assert(requeueQueue.item(freshDelivered.watchId)?.state == .delivered, "a recent delivery is left alone")
assert(requeueQueue.requeueSent(notIn: [sentCatch.watchId]).isEmpty && requeueQueue.item(sentCatch.watchId)?.state == .sent, "a sent catch the system still carries is left alone")
requeueQueue.advance([deliveredCatch.watchId, freshDelivered.watchId], to: .saved)
assert(requeueQueue.requeueDelivered(olderThan: 0, now: iso("2026-12-30T00:00:00.000Z")).isEmpty, "a saved catch is never sent again")
let deliveredJSON = String(data: try JSONEncoder().encode(deliveredCatch), encoding: .utf8)!
let legacyJSON = #"{"items":[{"entry":\#(deliveredJSON),"state":"delivered"}]}"#
let legacy = try JSONDecoder().decode(RiseCatchQueue.self, from: legacyJSON.data(using: .utf8)!)
assert(legacy.items.first?.state == .delivered && legacy.items.first?.deliveredAt == nil, "a queue file from an earlier build (no delivery time) still decodes")
var legacyRequeue = legacy
assert(legacyRequeue.requeueDelivered(olderThan: day, now: iso("2026-11-19T18:30:00.000Z")) == [deliveredCatch.watchId], "and is aged from when it was logged")
let diskQueue = RiseCatchQueue(items: [RiseQueuedCatch(entry: deliveredCatch, state: .delivered), RiseQueuedCatch(entry: sentCatch, state: .queued)])
let memoryQueue = RiseCatchQueue(items: [RiseQueuedCatch(entry: sentCatch, state: .sent), RiseQueuedCatch(entry: freshDelivered, state: .draft)])
let mergedQueue = diskQueue.merged(with: memoryQueue)
assert(mergedQueue.items.map { $0.entry.watchId } == [deliveredCatch.watchId, sentCatch.watchId, freshDelivered.watchId], "a queue that could not be read merges with the one in memory, once each")
assert(mergedQueue.item(sentCatch.watchId)?.state == .sent, "the further-along state wins")

group("Watch: a pack replaces the stored one unless it is the same or older")
let storedPack = decodedPack!
var newerPack = storedPack
newerPack.generatedAt = "2026-11-18T15:00:00.000Z"
var olderPack = storedPack
olderPack.generatedAt = "2026-11-18T13:00:00.000Z"
let storedBytes = try JSONEncoder().encode(storedPack)
let newerBytes = try JSONEncoder().encode(newerPack)
let olderBytes = try JSONEncoder().encode(olderPack)
let packNow = iso("2026-11-18T16:00:00.000Z")
assert(RiseWatchPack.shouldReplace(current: nil, currentData: nil, with: storedPack, data: storedBytes, now: packNow), "the first pack is kept")
assert(!RiseWatchPack.shouldReplace(current: storedPack, currentData: storedBytes, with: storedPack, data: storedBytes, now: packNow), "the same bytes again are not a change")
assert(RiseWatchPack.shouldReplace(current: storedPack, currentData: storedBytes, with: newerPack, data: newerBytes, now: packNow), "a newer pack replaces it")
assert(!RiseWatchPack.shouldReplace(current: storedPack, currentData: storedBytes, with: olderPack, data: olderBytes, now: packNow), "an older one arriving late does not")
var futurePack = storedPack
futurePack.generatedAt = "2026-11-19T16:00:00.000Z"
let futureBytes = try JSONEncoder().encode(futurePack)
assert(RiseWatchPack.shouldReplace(current: futurePack, currentData: futureBytes, with: olderPack, data: olderBytes, now: packNow),
       "but a stored pack stamped in the future (the phone's clock was ahead) does not block later ones")
futurePack.generatedAt = "2026-11-18T16:03:00.000Z"
let nearFutureBytes = try JSONEncoder().encode(futurePack)
assert(!RiseWatchPack.shouldReplace(current: futurePack, currentData: nearFutureBytes, with: olderPack, data: olderBytes, now: packNow),
       "a few minutes of clock skew is not treated as the future")

group("Watch: the pack carries the ODFW season and snow access, and older packs still decode")
let seasonPackJSON = """
{"version":1,"generatedAt":"2026-10-30T19:00:00.000Z","pacificDate":"2026-10-30","homeWaterId":"crane-prairie","species":[],
 "waters":[
  {"id":"crane-prairie","name":"Crane Prairie Reservoir","type":"Lake","home":true,"saved":false,"topPick":false,"score":8.3,"scoreSource":"Live-adjusted score",
   "flow":{"value":"","source":"unavailable"},"temp":{"value":"","source":"unavailable"},"flies":[],"hatches":[],
   "regulation":{"status":"open","label":"Open season (ODFW)","year":2026,"stale":false,"windows":{"from":"04-22","to":"10-31"}},
   "access":{"label":"Cascade Lakes Highway (OR-46) beyond Mt. Bachelor","typical":"Typically closed by snow from about mid-November to late May.","from":"11-15","to":"05-25","partial":false,"snowedIn":false}},
  {"id":"lower-deschutes","name":"Lower Deschutes","type":"River","home":false,"saved":true,"topPick":false,"score":7.0,"scoreSource":"Live-adjusted score",
   "flow":{"value":"","source":"unavailable"},"temp":{"value":"","source":"unavailable"},"flies":[],"hatches":[],
   "regulation":{"status":"open","label":"Open season (ODFW)","year":2026,"stale":false,"windows":{"sections":[{"name":"Lower","allYear":true},{"name":"Upper","from":"04-22","to":"12-31"}]}},
   "access":null},
  {"id":"verify-lake","name":"Verify Lake","type":"Lake","home":false,"saved":true,"topPick":false,"score":6.0,"scoreSource":"x",
   "flow":{"value":"","source":"unavailable"},"temp":{"value":"","source":"unavailable"},"flies":[],"hatches":[],
   "regulation":{"status":"unknown","label":"Season not confirmed - check ODFW","year":2026,"stale":false,"windows":null}},
  {"id":"odd-water","name":"Odd Water","type":"River","home":false,"saved":true,"topPick":false,"score":5.0,"scoreSource":"x",
   "flow":{"value":"","source":"unavailable"},"temp":{"value":"","source":"unavailable"},"flies":[],"hatches":[],
   "regulation":"closed!","access":7}
 ]}
"""
let seasonPack = RiseWatchPack.decode(seasonPackJSON.data(using: .utf8)!)
assert(seasonPack?.waters.count == 4, "every water decodes, the odd one too (\(seasonPack?.waters.map { $0.id } ?? []))")
let crane = seasonPack?.water(id: "crane-prairie")
let lowerD = seasonPack?.water(id: "lower-deschutes")
let verifyLake = seasonPack?.water(id: "verify-lake")
let oddWater = seasonPack?.water(id: "odd-water")
assert(crane?.regulation?.windows == RiseSeason(from: "04-22", to: "10-31") && crane?.regulation?.year == 2026, "the season window decodes")
assert(crane?.access?.from == "11-15" && crane?.access?.partial == false, "and the snow closure")
assert(lowerD?.regulation?.windows?.sections?.map { $0.name ?? "" } == ["Lower", "Upper"] && lowerD?.access == nil, "sections decode with their names; no closure is nil")
assert(oddWater?.regulation == nil && oddWater?.access == nil && oddWater?.score == 5.0, "a malformed season or closure is dropped, never the water")
assert(decodedPack?.waters.allSatisfy { $0.regulation == nil && $0.access == nil } == true, "a pack from before these fields decodes with none")
assert(decodedPack?.waters.first?.seasonNotice(on: catchTime) == nil && decodedPack?.waters.first?.isClosedSeason(on: catchTime) == false
       && decodedPack?.waters.first?.accessNotice(on: catchTime) == nil, "and shows no season label at all")
if let crane = crane, let seasonBytes = seasonPack?.encodedForTransfer() {
    let roundTrip = RiseWatchPack.decode(seasonBytes)
    assert(roundTrip?.water(id: "crane-prairie")?.regulation == crane.regulation && roundTrip?.water(id: "crane-prairie")?.access == crane.access,
           "the season and access survive the iPhone's re-encode")
}

group("Watch: the season is decided again on the day, on Oregon's clock")
if let crane = crane, let lowerD = lowerD, let verifyLake = verifyLake {
    // Oct 31 11:59 PM PDT is Nov 1 06:59 UTC; Nov 1 midnight PDT is 07:00 UTC.
    assert(crane.seasonStatus(on: iso("2026-10-31T18:00:00.000Z")) == .open, "Oct 31 is inside an Apr 22 - Oct 31 season (ends inclusive)")
    assert(crane.seasonStatus(on: iso("2026-11-01T06:59:00.000Z")) == .open, "11:59 PM Oct 31 in Oregon is still open, though it is Nov 1 in UTC")
    assert(crane.seasonStatus(on: iso("2026-11-01T07:00:00.000Z")) == .closed, "midnight Nov 1 in Oregon is closed")
    assert(crane.seasonStatus(on: iso("2026-04-22T07:00:00.000Z")) == .open && crane.seasonStatus(on: iso("2026-04-22T06:59:00.000Z")) == .closed, "the season opens at midnight Apr 22 in Oregon")
    let nov2 = iso("2026-11-02T19:00:00.000Z")
    assert(crane.isClosedSeason(on: nov2) && crane.seasonNotice(on: nov2) == "Closed season (ODFW)", "a pack built Oct 30 reads closed on Nov 2 (\(crane.seasonNotice(on: nov2) ?? "nil"))")
    assert(crane.regulation?.status == .open, "whatever status the pack was built with")
    assert(crane.seasonNotice(on: iso("2026-10-30T19:00:00.000Z")) == nil, "an open water prints no season label")
    assert(!crane.isSnowedIn(on: nov2) && crane.accessNotice(on: nov2) == nil, "Nov 2 is before the typical snow closure")
    assert(crane.isSnowedIn(on: iso("2026-11-15T19:00:00.000Z")) && crane.accessNotice(on: iso("2026-11-15T19:00:00.000Z")) == "Typically snowed in", "Nov 15 is inside it (inclusive)")
    assert(crane.isSnowedIn(on: iso("2027-01-10T19:00:00.000Z")) && crane.isSnowedIn(on: iso("2027-05-25T19:00:00.000Z")), "it wraps the new year, to May 25 inclusive")
    assert(!crane.isSnowedIn(on: iso("2027-05-26T19:00:00.000Z")), "and ends after May 25")
    assert(lowerD.seasonStatus(on: iso("2026-11-02T19:00:00.000Z")) == .open, "every section open is open")
    assert(lowerD.seasonStatus(on: iso("2027-01-15T19:00:00.000Z")) == .partial && lowerD.seasonNotice(on: iso("2027-01-15T19:00:00.000Z")) == "Some sections closed (ODFW)",
           "some sections closed is partial (\(lowerD.seasonNotice(on: iso("2027-01-15T19:00:00.000Z")) ?? "nil"))")
    assert(!lowerD.isClosedSeason(on: iso("2027-01-15T19:00:00.000Z")), "and partial is not closed")
    assert(verifyLake.seasonStatus(on: nov2) == .unknown && verifyLake.seasonNotice(on: nov2) == "Season not confirmed - check ODFW" && !verifyLake.isClosedSeason(on: nov2),
           "a verify water is unknown, never open or closed")
}
assert(RiseSeason(from: "12-01", to: "03-31").status(monthDay: "01-15") == .open && RiseSeason(from: "12-01", to: "03-31").status(monthDay: "11-30") == .closed, "a winter season wraps")
assert(RiseSeason(allYear: true).status(monthDay: "07-04") == .open, "all year is open")
assert(RiseSeason(from: "4-22", to: "10-31").status(monthDay: "05-01") == .unknown && RiseSeason(from: "13-01", to: "10-31").status(monthDay: "05-01") == .unknown,
       "a malformed window is unknown, never silently open or closed")
assert(RiseSeason(sections: []).status(monthDay: "05-01") == .unknown, "no sections at all is unknown")
assert(RiseSeason(sections: [RiseSeasonWindow(name: "A", allYear: true), RiseSeasonWindow(name: "B", from: "xx", to: "10-31")]).status(monthDay: "05-01") == .unknown,
       "one malformed section makes the water unknown")
assert(RiseSeason(sections: [RiseSeasonWindow(name: "A", from: "05-22", to: "09-30"), RiseSeasonWindow(name: "B", from: "05-22", to: "10-31")]).status(monthDay: "11-01") == .closed,
       "every section closed is closed")
assert(RisePacific.monthDay(iso("2026-03-01T07:59:00.000Z")) == "02-28" && RisePacific.monthDay(iso("2026-03-01T08:00:00.000Z")) == "03-01", "the month-day is Oregon's")
let staleRegulation = RiseWatchRegulation(status: .closed, label: "Closed season (ODFW)", year: 2026, stale: false, windows: RiseSeason(from: "04-22", to: "10-31"))
assert(staleRegulation.label(on: iso("2027-02-27T20:00:00.000Z")) == "Closed season (ODFW)", "before March 1 of the next year the label is ODFW's")
assert(staleRegulation.label(on: iso("2027-03-01T20:00:00.000Z")) == "Closed season (2026 rules)", "from March 1 it says whose rules they are")
var flaggedStale = staleRegulation
flaggedStale.stale = true
assert(flaggedStale.label(on: iso("2026-11-02T20:00:00.000Z")) == "Closed season (2026 rules)", "and so it does whenever the phone said the summary may be out of date")
assert(RiseWatchRegulation(status: .unknown, label: "", year: 2026, stale: true, windows: nil).label(on: iso("2027-06-01T20:00:00.000Z")) == "Season not confirmed - check ODFW",
       "the unknown label never changes")
let partialAccess = RiseWatchAccess(label: "Road", typical: "Typically closed", from: "11-15", to: "05-25", partial: true, snowedIn: true)
assert(!partialAccess.isSnowedIn(on: iso("2026-12-10T19:00:00.000Z")), "a partial closure is never snowed in")
let windowless = RiseWatchAccess(label: "Road", typical: "Typically closed", from: nil, to: nil, partial: nil, snowedIn: true)
assert(windowless.isSnowedIn(on: iso("2026-12-10T19:00:00.000Z")), "with no usable window, the phone's word is kept")

print("\n\(checks - failures)/\(checks) checks passed")
exit(failures == 0 ? 0 : 1)
