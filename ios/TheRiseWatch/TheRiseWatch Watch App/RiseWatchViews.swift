// UNCOMPILED. Written for the watchOS 10 SDK in Swift 5 mode; see
// docs/watch-app.md.
//
// Wet, cold hands in sun or rain: big targets (the main buttons are 56-80pt
// tall and full width), high contrast, short words, nothing that needs a
// precise tap. Every reading is printed with its provenance and age.

import SwiftUI

// MARK: - Style

enum RiseWatchColors {
    /// Fish on!: bright yellow-green, black text - readable in direct sun.
    static let fishOn = Color(red: 0.80, green: 0.95, blue: 0.25)
    static let secondaryButton = Color(white: 0.24)
    static let measured = Color(red: 0.45, green: 0.90, blue: 0.55)
    static let stale = Color(red: 1.0, green: 0.75, blue: 0.30)
    static let reference = Color(white: 0.70)
    static let warning = Color(red: 1.0, green: 0.45, blue: 0.40)
}

struct RiseBigButtonStyle: ButtonStyle {
    var fill: Color
    var text: Color
    var minHeight: CGFloat = 56
    var fontSize: CGFloat = 19

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: fontSize, weight: .heavy, design: .rounded))
            .multilineTextAlignment(.center)
            .foregroundStyle(text)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .padding(.horizontal, 6)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(fill.opacity(configuration.isPressed ? 0.7 : 1))
            )
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

func riseScoreText(_ score: Double?) -> String {
    guard let score = score else { return "-" }
    return String(format: "%.1f", score)
}

// MARK: - Empty state

struct RiseEmptyPackView: View {
    @EnvironmentObject private var model: RiseWatchModel

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Image(systemName: "iphone.and.arrow.forward")
                    .font(.system(size: 34))
                    .accessibilityHidden(true)
                Text("Open The Rise on your iPhone once to send today's waters.")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text("After that this Watch keeps them, and works with the phone left behind.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                RiseStatusFooter()
            }
            .padding(.vertical, 8)
        }
        .navigationTitle("The Rise")
    }
}

// MARK: - Status

/// Today's count and what has not reached the iPhone's journal yet.
struct RiseStatusFooter: View {
    @EnvironmentObject private var model: RiseWatchModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Today: \(model.fishToday()) on this Watch")
                .font(.headline)
            if model.unsyncedCount > 0 {
                Text("Unsynced: \(model.unsyncedCount)")
                    .font(.headline)
                    .foregroundStyle(RiseWatchColors.stale)
                if model.queue.waitingOnPhoneCount == model.unsyncedCount {
                    Text("On your iPhone - open The Rise there to add them to your journal.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Kept on this Watch. They go to your iPhone when it is in range.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else if model.fishToday() > 0 {
                Text("All in your iPhone journal.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let error = model.saveError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(RiseWatchColors.warning)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Waters list

struct RiseWatersListView: View {
    @EnvironmentObject private var model: RiseWatchModel
    let pack: RiseWatchPack

    var body: some View {
        List {
            Section {
                Button {
                    Task { await model.locate() }
                } label: {
                    Label(model.locateState == .locating ? "Finding you..." : "Which water am I on?", systemImage: "location.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                }
                .disabled(model.locateState == .locating)
                if let message = model.locateMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if model.packIsOld() {
                Section {
                    Text("This trip pack is from an earlier day. Readings show their age; open The Rise on your iPhone to refresh it.")
                        .font(.footnote)
                        .foregroundStyle(RiseWatchColors.stale)
                }
            }
            Section {
                ForEach(model.orderedWaters) { water in
                    NavigationLink(value: water.id) {
                        RiseWaterRow(water: water)
                    }
                }
            }
            Section {
                RiseStatusFooter()
            }
        }
        .navigationTitle("The Rise")
        .navigationDestination(for: String.self) { waterId in
            RiseWaterView(waterId: waterId)
        }
    }
}

struct RiseWaterRow: View {
    @EnvironmentObject private var model: RiseWatchModel
    let water: RiseWatchWater

    private var role: String {
        if water.home { return "Home" }
        if water.saved { return water.topPick ? "Saved - top pick" : "Saved" }
        return water.topPick ? "Top pick" : ""
    }

    var body: some View {
        // The pack can be days old: the season is decided on today's date.
        let now = Date()
        let closed = water.isClosedSeason(on: now)
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(water.name)
                    .font(.headline)
                    .lineLimit(2)
                if let season = water.seasonNotice(on: now) {
                    Text(season)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(closed ? RiseWatchColors.warning : RiseWatchColors.stale)
                }
                if let access = water.accessNotice(on: now) {
                    Text(access)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(RiseWatchColors.stale)
                }
                Text([role, model.asOfText()].filter { !$0.isEmpty }.joined(separator: " - "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            // A closed water has no score to show: its label says why.
            if !closed {
                Text(riseScoreText(water.score))
                    .font(.system(size: 24, weight: .bold, design: .rounded).monospacedDigit())
            }
        }
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - One water

struct RiseWaterView: View {
    @EnvironmentObject private var model: RiseWatchModel
    let waterId: String

    var body: some View {
        if let water = model.pack?.water(id: waterId) {
            RiseWaterDetail(water: water)
        } else {
            Text("This water is no longer in your trip pack. Open The Rise on your iPhone to send it again.")
                .font(.footnote)
                .multilineTextAlignment(.center)
        }
    }
}

struct RiseWaterDetail: View {
    @EnvironmentObject private var model: RiseWatchModel
    let water: RiseWatchWater

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                scoreHeader
                primeWindow
                RiseReadingsBlock(water: water)
                nextFly
                fishOnButton
                RiseLastCatchPanel(water: water)
                RiseStatusFooter()
                plannerAndHatches
            }
            .padding(.vertical, 4)
        }
        .navigationTitle(water.name)
        .task(id: water.id) {
            await model.refreshLive(water)
        }
        // Sealed from onDismiss, not from the sheet content's onDisappear:
        // the content swaps its length step for its species step, and an
        // onDisappear there fired on Next and closed the sheet.
        .sheet(item: $model.detailsFor, onDismiss: {
            model.detailsDismissed()
        }) { entry in
            RiseCatchDetailsView(entry: entry, species: model.pack?.species ?? [])
                .environmentObject(model)
        }
    }

    /// The score, or - on a water closed by ODFW season today - the label
    /// in its place. Partial, unconfirmed and snowed-in waters keep the
    /// score with the label under it.
    private var scoreHeader: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let closed = water.isClosedSeason(on: context.date)
            VStack(alignment: .leading, spacing: 2) {
                if closed {
                    Text(water.seasonNotice(on: context.date) ?? RiseWatchRegulation.baseLabel(.closed))
                        .font(.system(size: 22, weight: .heavy, design: .rounded))
                        .foregroundStyle(RiseWatchColors.warning)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        Text(riseScoreText(water.score))
                            .font(.system(size: 40, weight: .heavy, design: .rounded).monospacedDigit())
                        Text("/ 10")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Text(water.scoreSource)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let season = water.seasonNotice(on: context.date) {
                        Text(season)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(RiseWatchColors.stale)
                    }
                }
                if let access = water.accessNotice(on: context.date) {
                    Text(access)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(RiseWatchColors.stale)
                }
                Text(model.asOfText())
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// No countdown to a window on a water that is closed today.
    private var primeWindow: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            if !water.isClosedSeason(on: context.date) {
                let status = RisePrimeWindow.status(water.primeWindow, now: context.date)
                VStack(alignment: .leading, spacing: 2) {
                    Text(status.text)
                        .font(.headline)
                    Text(status.range)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if model.packIsOld(now: context.date) {
                        Text("Window hours from an earlier day's pack.")
                            .font(.caption2)
                            .foregroundStyle(RiseWatchColors.stale)
                    }
                }
            }
        }
    }

    private var nextFly: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Next fly")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(model.currentFly(water).isEmpty ? "No fly in the pack" : model.currentFly(water))
                .font(.title3.weight(.bold))
                .fixedSize(horizontal: false, vertical: true)
            if water.flies.count > 1 {
                Button("Not working") {
                    model.nextFly(water)
                }
                .buttonStyle(RiseBigButtonStyle(fill: RiseWatchColors.secondaryButton, text: .white))
                .accessibilityHint("Shows the next fly in today's list")
            }
        }
    }

    /// Fish on! stays: it is a journal, not an enforcement tool. On a closed
    /// water the label is right beside it, so it cannot be missed.
    private var fishOnButton: some View {
        VStack(alignment: .leading, spacing: 4) {
            if water.isClosedSeason(on: Date()), let season = water.seasonNotice(on: Date()) {
                Text(season)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(RiseWatchColors.warning)
            }
            Button {
                model.fishOn(water)
            } label: {
                Text("Fish on!")
            }
            .buttonStyle(RiseBigButtonStyle(fill: RiseWatchColors.fishOn, text: .black, minHeight: 80, fontSize: 28))
            .accessibilityHint("Logs a catch on \(water.name) now")
        }
    }

    @ViewBuilder
    private var plannerAndHatches: some View {
        if let best = water.planner?.best, let score = best.score {
            VStack(alignment: .leading, spacing: 2) {
                Text("Best day this week: \(best.label) \(riseScoreText(score))")
                    .font(.footnote.weight(.semibold))
                if !best.reason.isEmpty {
                    Text(best.reason)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text("Forecast weather and season only.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        if !water.hatches.isEmpty {
            Text("Hatches: \(water.hatches.joined(separator: ", "))")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

struct RiseReadingsBlock: View {
    @EnvironmentObject private var model: RiseWatchModel
    let water: RiseWatchWater

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            VStack(alignment: .leading, spacing: 6) {
                RiseReadingRow(label: "Flow", stamped: model.stamped(water, .flow, now: context.date), now: context.date)
                RiseReadingRow(label: "Water", stamped: model.stamped(water, .temp, now: context.date), now: context.date)
            }
        }
    }
}

struct RiseReadingRow: View {
    let label: String
    let stamped: RiseStampedReading
    let now: Date

    private var tint: Color {
        switch stamped.source {
        case .measured: return RiseWatchColors.measured
        case .stale: return RiseWatchColors.stale
        case .reference, .unavailable: return RiseWatchColors.reference
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text(stamped.value.isEmpty ? "Not available" : stamped.value)
                    .font(.headline.monospacedDigit())
            }
            let words = RiseReadingRules.label(stamped, now: now)
            if !words.isEmpty {
                Text(words)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(tint)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - After Fish on!

struct RiseLastCatchPanel: View {
    @EnvironmentObject private var model: RiseWatchModel
    let water: RiseWatchWater

    var body: some View {
        if let entry = model.lastCatch, entry.waterId == water.id {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .leading, spacing: 6) {
                    Text("Logged \(entry.time)\(entry.fly.isEmpty ? "" : " - \(entry.fly)")")
                        .font(.headline)
                    if model.canUndo(context.date), let until = model.undoUntil {
                        Button("Undo (\(max(1, Int(until.timeIntervalSince(context.date).rounded(.up)))))") {
                            model.undo()
                        }
                        .buttonStyle(RiseBigButtonStyle(fill: RiseWatchColors.secondaryButton, text: .white))
                    }
                    if model.canAddDetails(entry) {
                        Button("Length / species") {
                            model.openDetails()
                        }
                        .buttonStyle(RiseBigButtonStyle(fill: RiseWatchColors.secondaryButton, text: .white))
                    } else if let saved = model.queue.item(entry.watchId)?.entry {
                        let details = [saved.fish, saved.length.isEmpty ? "" : "\(saved.length) in"].filter { !$0.isEmpty }.joined(separator: ", ")
                        if !details.isEmpty {
                            Text(details)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let problem = model.detailsError {
                        Text(problem)
                            .font(.footnote)
                            .foregroundStyle(RiseWatchColors.warning)
                    }
                }
            }
        }
    }
}

struct RiseCatchDetailsView: View {
    @EnvironmentObject private var model: RiseWatchModel
    @Environment(\.dismiss) private var dismiss
    let entry: RiseWatchCatch
    let species: [String]

    @State private var length: Double = 0
    @State private var choosingSpecies = false
    @FocusState private var crownFocused: Bool

    // No onDisappear here: modifiers on a Group apply to whichever step is
    // showing, so it fired when Next swapped the steps. The sheet's
    // onDismiss (RiseWaterDetail) seals the catch instead.
    var body: some View {
        Group {
            if choosingSpecies {
                speciesStep
            } else {
                lengthStep
            }
        }
    }

    private var lengthStep: some View {
        VStack(spacing: 8) {
            Text("Length")
                .font(.headline)
            Text(length > 0 ? "\(RiseWatchCatch.lengthText(length)) in" : "Turn the Crown")
                .font(.system(size: length > 0 ? 34 : 18, weight: .bold, design: .rounded).monospacedDigit())
                .frame(maxWidth: .infinity, minHeight: 48)
                .focusable(true)
                .focused($crownFocused)
                .digitalCrownRotation($length, from: 0, through: 40, by: 0.5, sensitivity: .medium, isContinuous: false, isHapticFeedbackEnabled: true)
            Button(length > 0 ? "Next" : "Skip length") {
                choosingSpecies = true
            }
            .buttonStyle(RiseBigButtonStyle(fill: RiseWatchColors.fishOn, text: .black))
        }
        .onAppear {
            crownFocused = true
        }
    }

    private var speciesStep: some View {
        List {
            ForEach(species, id: \.self) { name in
                Button(name) {
                    model.saveDetails(entry.watchId, length: length, species: name)
                    dismiss()
                }
                .font(.headline)
                .frame(minHeight: 48)
            }
            Button("Skip species") {
                model.saveDetails(entry.watchId, length: length, species: nil)
                dismiss()
            }
            .font(.headline)
            .frame(minHeight: 48)
        }
    }
}
