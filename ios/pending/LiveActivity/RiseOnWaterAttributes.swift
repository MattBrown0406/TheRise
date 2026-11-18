// UNCOMPILED. Not part of any target yet. See docs/on-the-water-native.md.
//
// Target membership when added: BOTH the TheRise app target and the
// RiseOnWater widget extension target. ActivityKit matches an activity to its
// widget by this type, so the two targets must compile the same definition.

import ActivityKit
import Foundation

/// The "On the water" Live Activity: the prime-window countdown, the current
/// readings with where they came from, and the next fly to try.
///
/// Everything the angler can see changes over a session, so it all lives in
/// `ContentState`. The web page owns the values and posts them over the
/// `riseLiveActivity` bridge; nothing here computes a reading or a window.
struct RiseOnWaterAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var waterId: String
        var waterName: String
        /// "before", "during", "after" or "unknown" - as the page computed it
        /// when it posted. The views also check the dates against the clock,
        /// because the phone may be locked when a boundary passes.
        var primeWindowState: String
        var primeWindowStart: Date?
        var primeWindowEnd: Date?
        /// Display text exactly as the app shows it, e.g. "4,160 cfs".
        var flow: String
        /// "measured", "stale", "reference" or "unavailable". Shown beside the
        /// number on every surface: a reading never travels without it.
        var flowSource: String
        var temp: String
        var tempSource: String
        var nextFly: String
        var fishToday: Int
    }

    /// Fixed for the life of the activity.
    var startedAt: Date
}

extension RiseOnWaterAttributes.ContentState {
    /// The word printed next to a reading. Mirrors readingProvenanceWord() in
    /// the-rise-app.html, so the Lock Screen never says more than the app does.
    static func provenanceWord(_ source: String) -> String {
        switch source {
        case "measured": return "measured"
        case "stale": return "measured earlier"
        case "reference": return "reference"
        default: return ""
        }
    }

    var flowLabel: String {
        let word = Self.provenanceWord(flowSource)
        return word.isEmpty ? flow : "\(flow) (\(word))"
    }

    var tempLabel: String {
        let word = Self.provenanceWord(tempSource)
        return word.isEmpty ? temp : "\(temp) (\(word))"
    }
}
