import Foundation
import UserNotifications
import BackgroundTasks

/// The UserNotifications and BackgroundTasks half of alerts for saved waters.
/// Every decision - what a rule is, whether a reading is current, whether a
/// water has already alerted today, when a great-day alert fires - is made in
/// RiseAlerts, which is Foundation-only and tested off-device. This file only
/// carries those decisions out.
enum RiseNotifications {
    private static let userAgent = "The Rise iOS/1.0 (Central Oregon fly-fishing companion)"

    // MARK: Permission

    static func authorizationStatusString() async -> String {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .ephemeral:
            return "granted"
        case .provisional:
            return "provisional"
        case .denied:
            return "denied"
        case .notDetermined:
            return "notDetermined"
        @unknown default:
            return "unknown"
        }
    }

    private static func canDeliver() async -> Bool {
        let status = await authorizationStatusString()
        return status == "granted" || status == "provisional"
    }

    // MARK: Rules from the web layer

    /// Stores the rules, withdraws great-day notifications for waters that no
    /// longer want them, and asks for permission only when the angler has
    /// just turned an alert on and iOS has never asked. Returns the
    /// permission status for the page to show.
    static func applyRules(_ rules: [RiseAlertRule], requestPermission: Bool) async -> String {
        RiseAlerts.saveRules(rules)
        let center = UNUserNotificationCenter.current()
        let wanted = Set(rules.filter { $0.greatDay != nil }.map { $0.waterId })
        let pending = await center.pendingNotificationRequests()
        let withdrawn = pending.map { $0.identifier }.filter { identifier in
            guard identifier.hasPrefix("greatday.") else { return false }
            return !wanted.contains(where: { identifier.hasPrefix(RiseAlerts.greatDayPrefix(waterId: $0)) })
        }
        if !withdrawn.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: withdrawn)
        }

        var status = await authorizationStatusString()
        if requestPermission && !rules.isEmpty && status == "notDetermined" {
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
            status = await authorizationStatusString()
        }
        scheduleFlowCheck()
        return status
    }

    // MARK: Great day ahead

    /// Replaces each water's pending great-day notifications with the ones
    /// this plan calls for. A water the plan does not mention is left alone.
    static func scheduleGreatDays(_ plans: [RiseGreatDayPlan], now: Date = Date()) async {
        guard await canDeliver() else { return }
        let center = UNUserNotificationCenter.current()
        let thresholds = Dictionary(
            RiseAlerts.loadRules().compactMap { rule in rule.greatDay.map { (rule.waterId, $0.threshold) } },
            uniquingKeysWith: { first, _ in first }
        )
        let pending = await center.pendingNotificationRequests().map { $0.identifier }
        for plan in plans {
            guard let threshold = thresholds[plan.waterId] else { continue }
            let prefix = RiseAlerts.greatDayPrefix(waterId: plan.waterId)
            let stale = pending.filter { $0.hasPrefix(prefix) }
            if !stale.isEmpty {
                center.removePendingNotificationRequests(withIdentifiers: stale)
            }
            for planned in RiseAlerts.greatDayNotifications(plan: plan, threshold: threshold, now: now) {
                // The fire date is an instant (6 PM Pacific); expressed in the
                // device's own calendar it fires at that instant wherever the
                // phone is.
                let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: planned.fireDate)
                let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
                let request = UNNotificationRequest(identifier: planned.identifier, content: content(for: planned), trigger: trigger)
                try? await center.add(request)
            }
        }
    }

    private static func content(for planned: RisePlannedNotification) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = planned.title
        content.body = planned.body
        content.sound = .default
        return content
    }

    // MARK: Flow in range (background)

    /// Must be called before application(_:didFinishLaunchingWithOptions:)
    /// returns; BGTaskScheduler refuses registrations after launch.
    static func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: RiseAlerts.flowCheckTaskIdentifier, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handleFlowCheck(refresh)
        }
    }

    /// Asks iOS for the next background check. iOS decides when it runs -
    /// earliestBeginDate is a floor, not a schedule - and may not run it at
    /// all if Background App Refresh is off. With no flow rule there is
    /// nothing to check, and any pending request is withdrawn.
    static func scheduleFlowCheck() {
        let hasFlowRule = RiseAlerts.loadRules().contains { $0.flow != nil }
        guard hasFlowRule else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: RiseAlerts.flowCheckTaskIdentifier)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: RiseAlerts.flowCheckTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 2 * 3600)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // The simulator, or Background App Refresh turned off: the next
            // launch or trip to the background asks again.
        }
    }

    private static func handleFlowCheck(_ task: BGAppRefreshTask) {
        scheduleFlowCheck()
        let work = Task {
            let finished = await runFlowCheck()
            task.setTaskCompleted(success: finished)
        }
        task.expirationHandler = {
            work.cancel()
        }
    }

    /// Reads each alert-enabled gauge once and posts a notification for a
    /// water whose flow has just moved into the angler's range. Returns false
    /// if the run was cut short.
    @discardableResult
    static func runFlowCheck(now: Date = Date()) async -> Bool {
        let rules = RiseAlerts.loadRules().filter { $0.flow != nil && RiseAlerts.isValidSiteId($0.site) }
        guard !rules.isEmpty else { return true }
        guard await canDeliver() else { return true }

        var state = RiseAlerts.loadFlowState()
        var completed = true
        for rule in rules {
            if Task.isCancelled {
                completed = false
                break
            }
            guard let flow = rule.flow, let url = RiseAlerts.usgsURL(site: rule.site) else { continue }
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            guard let fetched = try? await URLSession.shared.data(for: request) else { continue }
            let (data, response) = fetched
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let reading = RiseAlerts.parseUsgsFlow(data, now: now) else {
                continue
            }
            let key = RiseAlerts.flowStateKey(waterId: rule.waterId, flow: flow)
            let decision = RiseAlerts.flowDecision(flow: flow, reading: reading, previous: state[key], now: now)
            state[key] = decision.state
            if decision.notify {
                let planned = RiseAlerts.flowNotification(rule: rule, flow: flow, reading: reading)
                // A nil trigger delivers now.
                let notification = UNNotificationRequest(identifier: planned.identifier, content: content(for: planned), trigger: nil)
                try? await UNUserNotificationCenter.current().add(notification)
            }
        }
        RiseAlerts.saveFlowState(RiseAlerts.prunedFlowState(state, rules: rules))
        return completed
    }
}
