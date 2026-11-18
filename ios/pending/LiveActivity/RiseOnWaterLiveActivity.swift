// UNCOMPILED. Not part of any target yet. See docs/on-the-water-native.md.
//
// Target membership when added: the RiseOnWater widget extension only.
// Replaces the template files Xcode generates for a Widget Extension with
// "Include Live Activity" ticked (delete those, keep this).
//
// Written against iOS 17 (the app's deployment target). Every countdown is
// drawn by the system from the dates in the content state, so the card keeps
// counting while the phone is locked without the app posting anything.

import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RiseOnWaterWidgetBundle: WidgetBundle {
    var body: some Widget {
        RiseOnWaterLiveActivity()
    }
}

struct RiseOnWaterLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RiseOnWaterAttributes.self) { context in
            RiseOnWaterLockScreenView(state: context.state, isStale: context.isStale)
                // Black on white, as in the app: legible in direct sun.
                .activityBackgroundTint(Color.white)
                .activitySystemActionForegroundColor(Color.black)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Flow").font(.caption2).bold()
                        Text(context.state.flow).font(.headline)
                        ProvenanceText(source: context.state.flowSource)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Water").font(.caption2).bold()
                        Text(context.state.temp).font(.headline)
                        ProvenanceText(source: context.state.tempSource)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(context.state.waterName).font(.headline).lineLimit(1)
                        PrimeWindowCountdown(state: context.state, isStale: context.isStale)
                            .font(.title3.monospacedDigit().bold())
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Next fly: \(context.state.nextFly.isEmpty ? "-" : context.state.nextFly)")
                        .font(.subheadline)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "fish")
            } compactTrailing: {
                PrimeWindowCountdown(state: context.state, isStale: context.isStale, compact: true)
                    .font(.caption.monospacedDigit())
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "timer")
            }
            .keylineTint(Color(red: 0.059, green: 0.271, blue: 0.322))
        }
    }
}

/// Lock Screen and banner presentation. Also what an Apple Watch running
/// watchOS 11 shows in the Smart Stack when the phone is paired (it uses the
/// compact leading/trailing views above unless a .small family is added).
struct RiseOnWaterLockScreenView: View {
    let state: RiseOnWaterAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(state.waterName)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                if state.fishToday > 0 {
                    Text("\(state.fishToday) today")
                        .font(.subheadline.bold())
                }
            }
            PrimeWindowCountdown(state: state, isStale: isStale)
                .font(.title2.monospacedDigit().bold())
            HStack(alignment: .top, spacing: 16) {
                Reading(label: "Flow", value: state.flow, source: state.flowSource)
                Reading(label: "Water", value: state.temp, source: state.tempSource)
            }
            Text("Next fly: \(state.nextFly.isEmpty ? "-" : state.nextFly)")
                .font(.subheadline.bold())
                .lineLimit(1)
        }
        .foregroundStyle(Color.black)
        .padding(14)
    }
}

private struct Reading: View {
    let label: String
    let value: String
    let source: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption2).bold()
            Text(value.isEmpty ? "-" : value).font(.headline)
            ProvenanceText(source: source)
        }
    }
}

/// A reading never appears without where it came from.
private struct ProvenanceText: View {
    let source: String

    var body: some View {
        let word = RiseOnWaterAttributes.ContentState.provenanceWord(source)
        if !word.isEmpty {
            Text(word.uppercased())
                .font(.caption2.bold())
                .foregroundStyle(source == "measured" ? Color(red: 0.043, green: 0.4, blue: 0.522) : Color(red: 0.541, green: 0.478, blue: 0.361))
        }
    }
}

/// "Ends in 1:20:00" / "Starts in 40:00", counted by the system. The dates
/// are checked against the clock here as well as the posted state, because a
/// boundary can pass while the phone is locked and the app cannot post. The
/// controller sets staleDate to the next boundary so the system redraws there.
/// `isStale` is accepted for a future "open the app to refresh" treatment.
struct PrimeWindowCountdown: View {
    let state: RiseOnWaterAttributes.ContentState
    let isStale: Bool
    var compact = false

    var body: some View {
        let now = Date()
        if let start = state.primeWindowStart, let end = state.primeWindowEnd, end > start {
            if now < start {
                HStack(spacing: 4) {
                    if !compact { Text("Starts in") }
                    Text(timerInterval: now...start, countsDown: true)
                }
            } else if now < end {
                // Reached either from a "during" post, or from a "before" post
                // whose staleDate (the window start) made the system redraw.
                HStack(spacing: 4) {
                    if !compact { Text("Ends in") }
                    Text(timerInterval: start...end, countsDown: true)
                }
            } else {
                Text(compact ? "Done" : "Prime window passed")
            }
        } else {
            Text(compact ? "-" : "Prime window: first calm hour")
        }
    }
}
