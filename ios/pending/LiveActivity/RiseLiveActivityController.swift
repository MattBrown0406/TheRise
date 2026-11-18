// UNCOMPILED. Not part of any target yet. See docs/on-the-water-native.md.
//
// Target membership when added: the TheRise app target only.
//
// The app side of the Live Activity. RiseViewController forwards every
// `riseLiveActivity` script message here (the registration is a step in the
// doc, not in this file). The page posts:
//
//   { action: "start",  waterId, waterName, primeWindowState,
//     primeWindowStart, primeWindowEnd, flow, flowSource, temp, tempSource,
//     nextFly, fishToday }
//   { action: "update", ...the same fields }
//   { action: "end" }
//
// Dates are ISO 8601 strings from Date.prototype.toISOString() (with
// milliseconds), or null when the prime window is decided by wind.
// The page only posts when the content changed, and only while its
// "On the water" view is open.

import ActivityKit
import Foundation

@MainActor
final class RiseLiveActivityController {
    static let shared = RiseLiveActivityController()

    private var activity: Activity<RiseOnWaterAttributes>?

    private init() {}

    /// Entry point for WKScriptMessage.body. Anything malformed is ignored:
    /// the Lock Screen card is a convenience, never the source of truth.
    func handle(_ body: Any) {
        guard let payload = body as? [String: Any],
              let action = payload["action"] as? String else {
            return
        }
        switch action {
        case "start", "update":
            guard let state = Self.contentState(from: payload) else { return }
            show(state)
        case "end":
            end()
        default:
            return
        }
    }

    // MARK: - ActivityKit

    private func show(_ state: RiseOnWaterAttributes.ContentState) {
        let content = ActivityContent(state: state, staleDate: Self.staleDate(for: state))
        // A launch after the app was killed with an activity still on the Lock
        // Screen adopts it instead of starting a second one.
        if activity == nil {
            activity = Activity<RiseOnWaterAttributes>.activities.first
        }
        if let activity {
            Task { await activity.update(content) }
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            activity = try Activity.request(
                attributes: RiseOnWaterAttributes(startedAt: Date()),
                content: content,
                pushType: nil
            )
        } catch {
            // Too many activities, Live Activities switched off for the app,
            // or the app is in the background. The in-app view is unaffected.
            activity = nil
        }
    }

    private func end() {
        let running = activity.map { [$0] } ?? Activity<RiseOnWaterAttributes>.activities
        activity = nil
        for item in running {
            Task { await item.end(nil, dismissalPolicy: .immediate) }
        }
    }

    // MARK: - Parsing

    /// The next boundary of the window. Passing it marks the content stale,
    /// which makes the system redraw the card - so a "Starts in" countdown
    /// turns into "Ends in" at the start of the window even while the phone
    /// is locked and the page cannot post.
    static func staleDate(for state: RiseOnWaterAttributes.ContentState) -> Date? {
        switch state.primeWindowState {
        case "before": return state.primeWindowStart
        case "during": return state.primeWindowEnd
        default: return Date().addingTimeInterval(4 * 60 * 60)
        }
    }

    static func contentState(from payload: [String: Any]) -> RiseOnWaterAttributes.ContentState? {
        guard let waterId = payload["waterId"] as? String, !waterId.isEmpty,
              let waterName = payload["waterName"] as? String else {
            return nil
        }
        return RiseOnWaterAttributes.ContentState(
            waterId: waterId,
            waterName: waterName,
            primeWindowState: payload["primeWindowState"] as? String ?? "unknown",
            primeWindowStart: date(payload["primeWindowStart"]),
            primeWindowEnd: date(payload["primeWindowEnd"]),
            flow: payload["flow"] as? String ?? "",
            flowSource: payload["flowSource"] as? String ?? "unavailable",
            temp: payload["temp"] as? String ?? "",
            tempSource: payload["tempSource"] as? String ?? "unavailable",
            nextFly: payload["nextFly"] as? String ?? "",
            fishToday: (payload["fishToday"] as? NSNumber)?.intValue ?? 0
        )
    }

    private static let isoWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoPlain = ISO8601DateFormatter()

    private static func date(_ value: Any?) -> Date? {
        guard let text = value as? String, !text.isEmpty else { return nil }
        return isoWithFraction.date(from: text) ?? isoPlain.date(from: text)
    }
}
