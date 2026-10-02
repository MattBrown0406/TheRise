// Behaviour tests for RiseStore, the durable catch-journal storage.
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

print("\n\(checks - failures)/\(checks) checks passed")
exit(failures == 0 ? 0 : 1)
