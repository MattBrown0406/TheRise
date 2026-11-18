// Behaviour tests for RiseStore, the durable catch-journal storage, and for
// RiseAlerts, the decisions behind alerts for saved waters.
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

print("\n\(checks - failures)/\(checks) checks passed")
exit(failures == 0 ? 0 : 1)
