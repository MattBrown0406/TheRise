# On the water: Live Activity and Apple Watch plan

Status: **planned, not built.** The in-app "On the water" view ships in
`the-rise-app.html`. The Lock Screen / Dynamic Island Live Activity and any
Apple Watch presence need new Xcode targets, entitlements and signing that
cannot be safely created by hand-editing `project.pbxproj`, so they are not in
the project. Everything below has to be done in Xcode on a Mac.

> **The Swift files in `ios/pending/LiveActivity/` have never been compiled.**
> They are written against the iOS 17 ActivityKit/WidgetKit APIs (the app's
> deployment target is 17.0) but no toolchain has checked them. Expect to fix
> small compile errors when they are added. They are not referenced by
> `project.pbxproj` and are not part of any build today.

## What already exists on the web side

`the-rise-app.html` posts to `window.webkit.messageHandlers.riseLiveActivity`
**only if that handler exists** (`liveActivityHandler()`); today it never does,
so nothing is posted and nothing can fail. Once the native handler is
registered, the page sends:

| When | Message |
| --- | --- |
| On the water opens | `{ action: "start", ...content }` |
| The content changes (fly, water, catch, window state, a new reading) | `{ action: "update", ...content }` |
| Exit is tapped | `{ action: "end" }` |

`content` is:

| Field | Type | Notes |
| --- | --- | --- |
| `waterId`, `waterName` | string | The water on screen. |
| `primeWindowState` | `"before" \| "during" \| "after" \| "unknown"` | As computed by `primeWindowCountdown()`. |
| `primeWindowStart`, `primeWindowEnd` | ISO 8601 string with milliseconds, or `null` | Real instants on Oregon's clock; `null` when wind decides the window. |
| `flow`, `temp` | string | Display text exactly as the app shows it (`"4,160 cfs"`, `"53 F"`). |
| `flowSource`, `tempSource` | `"measured" \| "stale" \| "reference" \| "unavailable"` | Provenance. Every native surface must print it beside the number, as the app does. |
| `nextFly` | string | The fly On the water is currently suggesting. |
| `fishToday` | number | Fish logged on this water today (Pacific date). |

The page de-duplicates: it only posts when the JSON of `content` changed. The
15-second countdown tick posts nothing, because the system draws the countdown
from `primeWindowEnd`. Leaving the Trip tab or backgrounding the app does
**not** end the activity (that is when the Lock Screen card is useful); only
Exit does.

## Files waiting in `ios/pending/LiveActivity/`

| File | Target membership | What it is |
| --- | --- | --- |
| `RiseOnWaterAttributes.swift` | **App and widget extension** | `ActivityAttributes` with a `ContentState` mirroring the message above, plus provenance labels. |
| `RiseOnWaterLiveActivity.swift` | Widget extension only | `@main` widget bundle, Lock Screen view, Dynamic Island (expanded / compact / minimal). |
| `RiseLiveActivityController.swift` | App only | Parses the web message and calls `Activity.request` / `update` / `end`. Adopts an activity left over from a previous launch rather than starting a second. |

## Step by step in Xcode

1. **Branch.** Do this on its own branch; it changes `project.pbxproj`.
2. **Add the extension target.** File > New > Target > iOS > *Widget Extension*.
   - Product Name: `RiseOnWater`
   - Tick **Include Live Activity**; untick *Include Configuration App Intent*.
   - Team: the app's team (`4D2KRG86P2`). Bundle identifier becomes
     `com.mattbrown.therise.RiseOnWater`.
   - When asked, **Activate** the new scheme, then switch back to `TheRise`.
   - Embed in Application: `TheRise` (Xcode adds the *Embed Foundation
     Extensions* build phase).
3. **Match versions.** In the new target's Build Settings set
   `IPHONEOS_DEPLOYMENT_TARGET = 17.0`, and `MARKETING_VERSION` /
   `CURRENT_PROJECT_VERSION` to the app's values. An extension whose version
   differs from its app is rejected at upload, and
   `scripts/verify-release-readiness.py` reads every
   `CURRENT_PROJECT_VERSION` in the project and requires them all to match.
4. **Replace the template.** Delete the Swift files Xcode generated in the
   `RiseOnWater` group (the bundle, the widget, the Live Activity and its
   attributes). Drag in from `ios/pending/LiveActivity/`:
   - `RiseOnWaterLiveActivity.swift` - target membership **RiseOnWater** only.
   - `RiseOnWaterAttributes.swift` - target membership **TheRise and RiseOnWater**.
   - `RiseLiveActivityController.swift` - target membership **TheRise** only.

   Move them into `ios/TheRise/` (app files beside the others, extension files
   in the new `RiseOnWater/` folder) and delete `ios/pending/LiveActivity/`.
5. **Allow Live Activities.** In `ios/TheRise/TheRise/Info.plist` add
   `NSSupportsLiveActivities` = `YES` (Boolean). No push entitlement is needed:
   every update is local (`pushType: nil`).
6. **Register the bridge** in `RiseViewController.swift`:
   - In the `webView` initializer, beside the other handlers:
     `configuration.userContentController.add(messageProxy, name: "riseLiveActivity")`
   - In `deinit`, beside the others:
     `webView.configuration.userContentController.removeScriptMessageHandler(forName: "riseLiveActivity")`
   - At the **top** of `userContentController(_:didReceive:)`, before the
     subscription handling (which answers any unknown message with "Unknown
     purchase action"):

     ```swift
     if message.name == "riseLiveActivity" {
         let body = message.body
         Task { @MainActor in RiseLiveActivityController.shared.handle(body) }
         return
     }
     ```
7. **Privacy manifest.** Add a `PrivacyInfo.xcprivacy` to the extension's
   Resources (a copy of the app's: no tracking, no collected data, no
   required-reason APIs).
8. **App Groups: not needed** for this Live Activity. All data travels in the
   ActivityKit content state and the widget never reads storage. An App Group
   (`group.com.mattbrown.therise`) becomes necessary only for the watch phase
   below if a watch complication or Home Screen widget should read the journal
   or the last readings without the app running.
9. **Signing.** Automatic signing creates the App ID for the extension. If the
   team uses manual profiles, create an App Store profile for
   `com.mattbrown.therise.RiseOnWater` and select it for the Release
   configuration.
10. **Build and check.** Build for a simulator (Live Activities work on the
    iOS 17 simulator) and on a device:
    - Trip > **On the water**: a Live Activity appears; lock the phone and the
      Lock Screen card shows the water, the countdown, both readings with
      their provenance, and the next fly.
    - On an iPhone with a Dynamic Island, the compact view shows the
      countdown; long-press for the expanded view.
    - **Not working - next fly** and **Fish on!** update the card
      (`fishToday`); **Exit** removes it.
    - Settings > The Rise > Live Activities off: the in-app view still works
      and nothing errors.
11. **Release checks.** Run
    `python3 scripts/verify-release-readiness.py --online` on the Mac (it can
    now run the native storage tests too). Add release-check guards for the
    new handler the way `riseChrome` is guarded (registered once, removed in
    `deinit`).
12. **Review notes.** Mention the Live Activity in
    `app-store-metadata/en-US/review-notes.txt` (how to start it: Trip tab >
    On the water) and regenerate screenshots if any are added.

## Apple Watch plan

**Phase 1 - free with the Live Activity (no watch target).** On watchOS 11
and later, a paired Apple Watch shows an iPhone's Live Activities in the Smart
Stack automatically, using the compact leading/trailing views. Nothing to
build beyond the steps above. If the deployment target is raised to iOS 18, add
`.supplementalActivityFamilies([.small])` to the `ActivityConfiguration` and
branch on `@Environment(\.activityFamily)` for a watch-specific layout (big
countdown, next fly).

**Phase 2 - a watchOS app (later, separate change).** The useful watch
feature is a wrist-tap **Fish on!** while the phone stays in a pocket.

- New target: File > New > Target > watchOS > *App* ("The Rise Watch"),
  companion to TheRise, watchOS 10+. One screen: countdown, next fly, a full
  screen **Fish on!** button, and **Next fly**.
- Transport: `WatchConnectivity`. The phone pushes the same `content`
  dictionary the Live Activity gets with `updateApplicationContext`; the watch
  sends `{ action: "fishOn", waterId, fly, at }` with `sendMessage` when the
  phone is reachable, else `transferUserInfo` (queued, delivered later).
- Journal integrity: the journal lives in the web view (`localStorage`,
  mirrored by `RiseStore`). The phone must not write it from native code. A
  watch catch is appended to a pending-catches file by a new Foundation-only
  `RiseStore` function, and handed to the page on its next load through a new
  `window.risePendingCatches` bridge that writes through `setLogs` (failing
  closed, as every journal write does) and then clears the file. Readings on a
  watch catch carry `flowSource`/`tempSource` from the content the phone last
  pushed only if that reading was still fresh at the catch time; otherwise they
  are stored blank with `"unavailable"`, never guessed.
- Signing: a watch app needs its own App ID
  (`com.mattbrown.therise.watchkitapp`) and profile; an App Group is needed
  only if a complication reads shared state.

## What is not covered

- Push-token updates (`pushType: .token`): the app has no server.
- Starting a Live Activity from the background: ActivityKit only allows
  `Activity.request` while the app is in the foreground, which is when the
  angler opens On the water.
- None of this has been run. The web half is covered by
  `scripts/test-app-dom.mjs` ("Live Activity bridge"); the native half has no
  tests until it is in a target.
