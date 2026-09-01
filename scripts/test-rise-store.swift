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
let csv = "\"Date\",\"Water\"\r\n\"Jun 21, 2026\",\"Crooked River\"\r\n"
if let url = RiseStore.exportURL(csv: csv) {
    assert(url.pathExtension == "csv", "the export is a .csv file")
    assert((try? String(contentsOf: url, encoding: .utf8)) == csv, "the export contains the CSV verbatim")
    try? FileManager.default.removeItem(at: url)
} else {
    assert(false, "the export produces a file URL")
}

print("\n\(checks - failures)/\(checks) checks passed")
exit(failures == 0 ? 0 : 1)
