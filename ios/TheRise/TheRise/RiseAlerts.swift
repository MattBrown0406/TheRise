import Foundation

/// Alerts for saved waters: the rules the web layer sends, where they are kept,
/// and every decision about whether to notify.
///
/// Alerts are local notifications. Nothing here talks to a server of ours:
/// the rules are a JSON file in Application Support beside the catch journal,
/// a flow check is an anonymous read of the same public USGS endpoint the web
/// layer already reads, and a great-day alert is scheduled from the planner's
/// own day score. This file imports only Foundation, like RiseStore, so
/// scripts/test-rise-store.sh can compile and test it without Xcode. The
/// UserNotifications and BackgroundTasks half is RiseNotifications.swift.
struct RiseFlowRule: Codable, Equatable {
    var min: Double
    var max: Double
}

struct RiseGreatDayRule: Codable, Equatable {
    var threshold: Double
}

struct RiseAlertRule: Codable, Equatable {
    var waterId: String
    var waterName: String
    /// USGS site number; empty for a water with no gauge.
    var site: String
    var flow: RiseFlowRule?
    var greatDay: RiseGreatDayRule?
}

/// What the last background check saw, per water and range.
struct RiseFlowAlertState: Codable, Equatable {
    var lastInRange: Bool?
    var lastNotifiedDay: String?
}

struct RiseFlowReading: Equatable {
    var cfs: Double
    var observedAt: Date
}

struct RiseGreatDay: Equatable {
    /// A Pacific calendar date, yyyy-MM-dd.
    var date: String
    var label: String
    var score: Double
    var reason: String
}

struct RiseGreatDayPlan: Equatable {
    var waterId: String
    var waterName: String
    var days: [RiseGreatDay]
}

struct RisePlannedNotification: Equatable {
    var identifier: String
    var fireDate: Date
    var title: String
    var body: String
}

struct RiseFlowDecision: Equatable {
    var notify: Bool
    var state: RiseFlowAlertState
}

enum RiseAlerts {
    static let flowCheckTaskIdentifier = "com.mattbrown.therise.flowcheck"
    /// Every water in the app is in Central Oregon, so every date and time an
    /// alert talks about is on the water's clock, not the phone's.
    static let pacific = TimeZone(identifier: "America/Los_Angeles") ?? TimeZone(secondsFromGMT: -8 * 3600)!
    /// A reading older than this is not "the flow now".
    static let maxReadingAgeHours: Double = 6
    /// Great-day alerts arrive the evening before, about 6 PM Pacific.
    static let greatDayHour = 18
    static let maxRules = 32

    private static let rulesFileName = "alert-rules.json"
    private static let stateFileName = "alert-state.json"

    // MARK: Validation

    /// Water ids are the web layer's lowercase, hyphenated slugs.
    static func isValidWaterId(_ identifier: String) -> Bool {
        guard !identifier.isEmpty, identifier.count <= 64 else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-")
        return identifier.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    /// USGS site numbers are 8 to 15 digits. Anything else never reaches a URL.
    static func isValidSiteId(_ site: String) -> Bool {
        guard (8...15).contains(site.count) else { return false }
        return site.unicodeScalars.allSatisfy { CharacterSet.decimalDigits.contains($0) && $0.isASCII }
    }

    private static func number(_ value: Any?) -> Double? {
        if let value = value as? Double { return value.isFinite ? value : nil }
        if let value = value as? Int { return Double(value) }
        if let value = value as? NSNumber { return value.doubleValue.isFinite ? value.doubleValue : nil }
        if let value = value as? String { return Double(value) }
        return nil
    }

    /// Text from the page, as plain single-line text of bounded length.
    private static func cleanName(_ value: Any?, limit: Int = 80) -> String {
        let text = ((value as? String) ?? "")
            .components(separatedBy: .controlCharacters).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(text.prefix(limit))
    }

    /// One rule from the `setRules` message. A malformed half is dropped; a
    /// rule with neither half is no rule.
    static func rule(from dictionary: [String: Any]) -> RiseAlertRule? {
        guard let waterId = dictionary["waterId"] as? String, isValidWaterId(waterId) else { return nil }
        let name = cleanName(dictionary["waterName"])
        let site = dictionary["site"] as? String ?? ""
        var flow: RiseFlowRule?
        if isValidSiteId(site),
           let raw = dictionary["flow"] as? [String: Any],
           let min = number(raw["min"]), let max = number(raw["max"]),
           min >= 0, max > min, max <= 1_000_000 {
            flow = RiseFlowRule(min: min, max: max)
        }
        var greatDay: RiseGreatDayRule?
        if let raw = dictionary["greatDay"] as? [String: Any],
           let threshold = number(raw["threshold"]), (1...10).contains(threshold) {
            greatDay = RiseGreatDayRule(threshold: threshold)
        }
        guard flow != nil || greatDay != nil else { return nil }
        return RiseAlertRule(
            waterId: waterId,
            waterName: name.isEmpty ? waterId : name,
            site: isValidSiteId(site) ? site : "",
            flow: flow,
            greatDay: greatDay
        )
    }

    /// The `rules` array of a `setRules` message, one rule per water.
    static func rules(fromMessage payload: [String: Any]) -> [RiseAlertRule] {
        let raw = payload["rules"] as? [[String: Any]] ?? []
        var seen = Set<String>()
        var rules: [RiseAlertRule] = []
        for item in raw {
            guard let parsed = Self.rule(from: item), !seen.contains(parsed.waterId) else { continue }
            seen.insert(parsed.waterId)
            rules.append(parsed)
            if rules.count >= maxRules { break }
        }
        return rules
    }

    /// The `waters` array of a `scheduleGreatDays` message.
    static func greatDayPlans(fromMessage payload: [String: Any]) -> [RiseGreatDayPlan] {
        let raw = payload["waters"] as? [[String: Any]] ?? []
        return raw.compactMap { item -> RiseGreatDayPlan? in
            guard let waterId = item["waterId"] as? String, isValidWaterId(waterId) else { return nil }
            let name = cleanName(item["waterName"])
            let days = (item["days"] as? [[String: Any]] ?? []).compactMap { day -> RiseGreatDay? in
                guard let date = day["date"] as? String, dayStart(date) != nil,
                      let score = number(day["score"]), (1...10).contains(score) else { return nil }
                return RiseGreatDay(
                    date: date,
                    label: cleanName(day["label"], limit: 12),
                    score: score,
                    reason: cleanName(day["reason"], limit: 120)
                )
            }
            return RiseGreatDayPlan(waterId: waterId, waterName: name.isEmpty ? waterId : name, days: Array(days.prefix(7)))
        }
    }

    // MARK: Storage

    private static var rulesURL: URL? {
        RiseStore.baseDirectory?.appendingPathComponent(rulesFileName)
    }

    private static var stateURL: URL? {
        RiseStore.baseDirectory?.appendingPathComponent(stateFileName)
    }

    @discardableResult
    static func saveRules(_ rules: [RiseAlertRule]) -> Bool {
        guard let url = rulesURL, let data = try? JSONEncoder().encode(rules) else { return false }
        do {
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    static func loadRules() -> [RiseAlertRule] {
        guard let url = rulesURL, let data = try? Data(contentsOf: url),
              let rules = try? JSONDecoder().decode([RiseAlertRule].self, from: data) else {
            return []
        }
        return rules
    }

    static func loadFlowState() -> [String: RiseFlowAlertState] {
        guard let url = stateURL, let data = try? Data(contentsOf: url),
              let state = try? JSONDecoder().decode([String: RiseFlowAlertState].self, from: data) else {
            return [:]
        }
        return state
    }

    @discardableResult
    static func saveFlowState(_ state: [String: RiseFlowAlertState]) -> Bool {
        guard let url = stateURL, let data = try? JSONEncoder().encode(state) else { return false }
        do {
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// The state belongs to a water and a range together, so changing the
    /// range starts fresh: a new range the river is already in alerts once.
    static func flowStateKey(waterId: String, flow: RiseFlowRule) -> String {
        "\(waterId)|\(Int(flow.min))|\(Int(flow.max))"
    }

    /// Drops state for rules that no longer exist.
    static func prunedFlowState(_ state: [String: RiseFlowAlertState], rules: [RiseAlertRule]) -> [String: RiseFlowAlertState] {
        let live = Set(rules.compactMap { rule in rule.flow.map { flowStateKey(waterId: rule.waterId, flow: $0) } })
        return state.filter { live.contains($0.key) }
    }

    // MARK: USGS

    /// The same request shape the web layer uses, discharge only.
    static func usgsURL(site: String) -> URL? {
        guard isValidSiteId(site) else { return nil }
        return URL(string: "https://waterservices.usgs.gov/nwis/iv/?format=json&sites=\(site)&parameterCd=00060&siteStatus=all")
    }

    static func parseUsgsDate(_ text: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }

    /// The latest discharge reading in a USGS instantaneous-values response,
    /// or nil when there is no current measurement. An iced or retired sensor
    /// reports the no-data value, and siteStatus=all returns a sensor's last
    /// value however old it is; neither is the flow now.
    static func parseUsgsFlow(_ data: Data, now: Date = Date()) -> RiseFlowReading? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = root["value"] as? [String: Any],
              let series = value["timeSeries"] as? [[String: Any]] else {
            return nil
        }
        for entry in series {
            guard let variable = entry["variable"] as? [String: Any],
                  let codes = variable["variableCode"] as? [[String: Any]],
                  (codes.first?["value"] as? String) == "00060",
                  let blocks = entry["values"] as? [[String: Any]],
                  let points = blocks.first?["value"] as? [[String: Any]],
                  let latest = points.last,
                  let cfs = number(latest["value"]),
                  let stamp = latest["dateTime"] as? String,
                  let observedAt = parseUsgsDate(stamp) else {
                continue
            }
            let noData = number(variable["noDataValue"]) ?? -999_999
            if cfs == noData || cfs < 0 { continue }
            let ageHours = now.timeIntervalSince(observedAt) / 3600
            if ageHours > maxReadingAgeHours || ageHours < -1 { continue }
            return RiseFlowReading(cfs: cfs, observedAt: observedAt)
        }
        return nil
    }

    // MARK: Decisions

    static func pacificCalendar() -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = pacific
        return calendar
    }

    static func pacificDayKey(_ date: Date) -> String {
        let parts = pacificCalendar().dateComponents([.year, .month, .day], from: date)
        return String(format: "%04ld-%02ld-%02ld", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Notify when the flow moves into the range - not every check it stays
    /// there - and never more than once a day for a water, so a river hovering
    /// on the edge of the range does not alert every few hours.
    static func flowDecision(flow: RiseFlowRule, reading: RiseFlowReading, previous: RiseFlowAlertState?, now: Date) -> RiseFlowDecision {
        let inRange = reading.cfs >= flow.min && reading.cfs <= flow.max
        var state = previous ?? RiseFlowAlertState(lastInRange: nil, lastNotifiedDay: nil)
        let today = pacificDayKey(now)
        let entered = inRange && state.lastInRange != true
        let notify = entered && state.lastNotifiedDay != today
        state.lastInRange = inRange
        if notify { state.lastNotifiedDay = today }
        return RiseFlowDecision(notify: notify, state: state)
    }

    static func formatCfs(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value.rounded())) ?? String(Int(value.rounded()))
    }

    static func pacificTimeLabel(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = pacific
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }

    static func flowNotification(rule: RiseAlertRule, flow: RiseFlowRule, reading: RiseFlowReading) -> RisePlannedNotification {
        RisePlannedNotification(
            identifier: "flow.\(rule.waterId).\(pacificDayKey(reading.observedAt))",
            fireDate: reading.observedAt,
            title: "\(rule.waterName) is in your range",
            body: "USGS measured \(formatCfs(reading.cfs)) cfs at \(pacificTimeLabel(reading.observedAt)). Your range is \(formatCfs(flow.min))-\(formatCfs(flow.max)) cfs. Check conditions and regulations before you go."
        )
    }

    /// Midnight Pacific at the start of a yyyy-MM-dd date, or nil if it is not one.
    static func dayStart(_ dayKey: String) -> Date? {
        let parts = dayKey.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, dayKey.count == 10 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        let calendar = pacificCalendar()
        guard let date = calendar.date(from: components),
              pacificDayKey(date) == dayKey else { return nil }
        return date
    }

    /// About 6 PM Pacific the evening before the given date.
    static func eveningBefore(_ dayKey: String) -> Date? {
        let calendar = pacificCalendar()
        guard let start = dayStart(dayKey),
              let previous = calendar.date(byAdding: .day, value: -1, to: start) else { return nil }
        return calendar.date(bySettingHour: greatDayHour, minute: 0, second: 0, of: previous)
    }

    static func greatDayPrefix(waterId: String) -> String {
        "greatday.\(waterId)."
    }

    /// The notifications to hold for one water: a day at or above the
    /// threshold, announced the evening before, if that evening is still to
    /// come. The identifier names the water and the date, so a newer plan
    /// replaces an older one instead of stacking beside it.
    static func greatDayNotifications(plan: RiseGreatDayPlan, threshold: Double, now: Date) -> [RisePlannedNotification] {
        plan.days
            .filter { $0.score >= threshold }
            .compactMap { day -> RisePlannedNotification? in
                guard let fire = eveningBefore(day.date), fire > now else { return nil }
                let label = day.label.isEmpty ? "Tomorrow" : day.label
                let reason = day.reason.isEmpty ? "" : " - \(day.reason)"
                return RisePlannedNotification(
                    identifier: "\(greatDayPrefix(waterId: plan.waterId))\(day.date)",
                    fireDate: fire,
                    title: "Tomorrow looks good on \(plan.waterName)",
                    body: "\(label) scores \(String(format: "%.1f", day.score))\(reason). Forecast weather and season only - check flows and access before you drive."
                )
            }
    }
}
