# The Rise for Apple Watch

Status: **iPhone half built and in the TheRise target; Watch target to be
created in Xcode on a Mac.** "Some anglers may not bring their phone on the
water." The Watch app is built to be useful with the iPhone left in the truck
or at home, and with no cellular or Wi-Fi at all on the water.

> **None of the Swift in this feature has been compiled.** It was written for
> the iOS 17 / watchOS 10 SDKs in Swift 5 language mode on a machine with no
> Swift toolchain, Xcode or simulator. Expect to fix small compile errors on
> the first build. The web half and its tests run here and pass; the
> Foundation-only model file has behaviour tests in
> `scripts/test-rise-store.swift` that need a Swift toolchain to run.

## What the angler can do with the phone left behind

Once The Rise has been opened on the iPhone (so the page could build and send
a trip pack), the Watch on its own can:

- List the angler's waters - home first, then saved waters, then today's top
  pick - each with its score and "as of" the time the pack was built.
- Show a water: the score and its honest source label, a prime-window
  countdown computed on the Watch on Oregon's clock, flow and water
  temperature with their provenance and age ("measured 3h ago",
  "reference"), predicted hatches, and the week planner's best day if the
  angler had loaded the planner.
- Walk the day's fly list: **Next fly** with **Not working** to move on.
- **Fish on!**: one big button, a haptic, a catch written to a file on the
  Watch immediately, **Undo** for 8 seconds, then optional length (Digital
  Crown) and species. The catch waits on the Watch until the iPhone is in
  range - minutes or days - and then lands in the journal once.
- See **Today: N on this Watch** and **Unsynced: N**.
- **Which water am I on?** from the Watch's own GPS: the nearest pack water
  within two miles, or it says it couldn't tell.
- If the Watch has its own Wi-Fi or cellular, refresh a gauged water's flow
  and temperature straight from USGS. Any failure falls back to the pack
  silently.

## How it fits together

```
the-rise-app.html --riseWatch {action:"pack", body}--> RiseWatchBridge (iPhone)
     ^                                                   | updateApplicationContext (latest wins)
     |                                                   v
     | window.riseWatchCatches({catches})           RiseWatchConnector (Watch) -> trip-pack.json
     |                                                   |
     | riseWatch {action:"catchesSaved", ids}            | Fish on! -> catch-queue.json
     |                                                   | transferUserInfo (queued by the system)
RiseWatchBridge <--------------- catch ------------------+
     | writes watch-pending-catches.json FIRST, then hands every held catch to the page
     | deletes a held catch only on catchesSaved; then tells the Watch (transferUserInfo)
```

| File | Target | What it is |
| --- | --- | --- |
| `ios/TheRise/TheRise/RiseWatchModels.swift` | **TheRise and the Watch app**, and `scripts/test-rise-store.sh` | Foundation-only. Codable pack and catch types, the provenance rules, Oregon date/time formatting, prime-window countdown, nearest water, USGS parsing, the Watch's catch queue, the iPhone's held-catch inbox, and every WatchConnectivity payload. |
| `ios/TheRise/TheRise/RiseWatchBridge.swift` | TheRise | The iPhone's WCSessionDelegate. Activated in `AppDelegate` at launch. |
| `ios/TheRiseWatch/TheRiseWatch Watch App/RiseWatchApp.swift` | Watch app | `@main` and the root view. |
| `.../RiseWatchModel.swift` | Watch app | State: the pack, the queue, live readings, Fish on!, Undo, details, sending. |
| `.../RiseWatchConnector.swift` | Watch app | The Watch's WCSessionDelegate. |
| `.../RiseWatchLocator.swift` | Watch app | One CoreLocation fix for "Which water am I on?". |
| `.../RiseWatchLiveFetch.swift` | Watch app | The optional USGS read, 8-second timeout. |
| `.../RiseWatchViews.swift` | Watch app | SwiftUI: list, water, Fish on!, details, empty state. |
| `.../Info.plist`, `.../PrivacyInfo.xcprivacy`, `.../Assets.xcassets` | Watch app | Keys, privacy manifest, icon (the iPhone's 1024 px icon) and accent colour. |

### The trip pack (iPhone -> Watch)

The page builds it in `buildWatchPack()` and posts it with
`postWatchPack()` - debounced 1.5 s after any render, and only if the content
changed (the `generatedAt` stamp alone is not a change). Nothing is posted
unless `window.webkit.messageHandlers.riseWatch` exists. The bridge validates
it (`RiseWatchPack.decode`), re-encodes it (trimming planner days, then the
tail of the list, if it is over 48 KB) and sends
`["kind": "pack", "version": 1, "pack": <JSON Data>]` with
`updateApplicationContext`. The Watch reads the latest context again at every
activation and keeps the bytes in `trip-pack.json`.

```json
{
  "version": 1,
  "generatedAt": "2026-11-18T14:40:00.000Z",
  "pacificDate": "2026-11-18",
  "homeWaterId": "crooked",
  "species": ["Redband Trout", "Bull Trout", "..."],
  "waters": [{
    "id": "crooked", "name": "Crooked River", "type": "River",
    "home": true, "saved": true, "topPick": false,
    "lat": 44.12, "lon": -120.79, "usgsSite": "14080500",
    "score": 8.1, "scoreSource": "Live-adjusted score",
    "primeWindow": { "startHour": 11, "endHour": 15 },
    "flow": { "value": "240 cfs", "source": "measured", "observedAt": "...", "cachedAt": "...", "reference": "235 cfs" },
    "temp": { "value": "47 F", "source": "reference", "observedAt": null, "cachedAt": null, "reference": "47 F" },
    "flies": ["Zebra Midge #20", "..."],
    "hatches": ["Midge", "BWO"],
    "planner": { "fetchedAt": "...", "days": [{ "date": "2026-11-19", "label": "Thu", "score": 8.4, "reason": "..." }], "best": { "...": "..." } }
  }]
}
```

- Up to ten waters: home, saved, top pick (`watchPackWaters()`).
- `score` / `scoreSource` are `fishScore()` and `scoreSourceLabel()`.
- `primeWindow` is `primeWindowHours()` - Pacific hours, `null` when wind
  decides the window. The Watch counts down from it (`RisePrimeWindow`).
- `flow` / `temp` carry `valueProvenance()`, `liveDisplayValue()`, when USGS
  took the reading and when the phone cached it, and the seasonal value the
  page falls back to. An ungauged river's flow is `"No live gauge"`,
  `unavailable`, with no fallback.
- `flies` is `liveRecommendedFlies()` then the daily fly box, six at most.
- `planner` is `plannerForWater()` only if the angler loaded the week;
  otherwise `null`. Nothing is fetched for the Watch.

### Provenance on the Watch

A pack can be hours or days old when a fish is caught, so the Watch applies
the page's rules again at that moment (`RiseReadingRules.stamp`):

- `measured` stays `measured` only inside the app's 12-hour fresh window
  (`READING_FRESH_HOURS`), aged from the older of `observedAt` and
  `cachedAt`. After that it is `stale` ("measured earlier", printed with its
  age). A measurement with no time at all is `stale`.
- `stale` stays `stale`. Nothing is ever upgraded; a `reference` value stays
  `reference` however recently the pack arrived.
- Past seven days (`READING_EXPIRY_HOURS`) a measurement is not used: the
  reading falls back to the seasonal value, labelled `reference`, or to
  nothing.
- A reading the Watch fetched itself from USGS is `measured`, aged by the
  same rules, and used only if it is newer than the pack's.

The previous plan (in `on-the-water-native.md`) blanked a reading that was no
longer fresh. That would have thrown away a real measurement the angler can
judge for themselves; `stale` with its age is what the page already does.

### Catches (Watch -> iPhone)

A Watch catch is exactly what Fish on! writes on the phone - `loggedAt`,
`date`, `time`, `waterId`, `waterName`, `fly`, `fish`, `length`, `count`,
`notes`, `flow`, `flowSource`, `temp`, `tempSource` - plus a UUID `watchId`.
No coordinates are ever put on a catch.

1. **Fish on!** builds the catch (`RiseWatchCatch.make`) and writes it to
   `catch-queue.json` as a draft. If that write fails nothing is logged and
   the Watch says so.
2. Undo (8 s) removes the draft by id. Length / species edit it. The draft is
   sealed when the details sheet closes, 60 s after the catch, or when the
   app goes to the background; a draft left by a killed app is sealed at the
   next launch.
3. Sealed catches go out with `transferUserInfo`
   (`["kind": "catch", "version": 1, "watchId": id, "catch": <JSON Data>]`).
   The system queues them and delivers them when the iPhone is next
   reachable, with either app running or not. At each activation the Watch
   resends any catch it marked sent that the system no longer carries.
4. The iPhone's `RiseWatchBridge` writes every catch to
   `Application Support/TheRise/watch-pending-catches.json` **before**
   anything else, then calls `window.riseWatchCatches({catches:[...]})` if
   the page is loaded - and again on every `didFinish`, after the journal
   restore.
5. The page (`window.riseWatchCatches`) converts each catch with
   `watchCatchEntry()` - re-dating it from `loggedAt` with the journal's own
   `zonedDateLabel()` / `zonedTimeLabel()`, so it reads exactly like the
   phone's entries in any locale, refusing a malformed id or time, and
   storing an unknown provenance as `unavailable` - then merges with
   `mergeWatchCatches()`: deduped on `watchId`, each inserted in front of the
   first entry logged before it, nothing else reordered. An open edit form
   is re-pointed at its entry by identity. It writes through `setLogs`. Only
   if that returned true does it post
   `riseWatch {action: "catchesSaved", ids}` (ids now in the journal,
   including any that were already there). A failed write or an unreadable
   journal acknowledges nothing and shows a notice on the Log screen.
6. The bridge deletes exactly the acknowledged catches from the pending file
   and tells the Watch (`["kind": "catchesSaved", "ids": [...]]`). The Watch
   marks them saved; "Unsynced" counts everything not yet saved. Saved
   catches are forgotten after three days; an unconfirmed one never is.

Journal entries from the Watch carry `watchId` and `loggedOn: "watch"`, and
the Log card says "Logged on Apple Watch". Editing one keeps both.

## Step by step in Xcode

1. **Branch.** This changes `project.pbxproj`; do it on its own branch.
2. **Add the target.** File > New > Target... > **watchOS** > **App** > Next.
   - Choose the **Watch App for Existing iOS App** variant, companion
     **TheRise** ("Embed in Companion Application: TheRise").
   - Product Name: **`TheRiseWatch`**. Xcode names the target and its folder
     `TheRiseWatch Watch App`, which is the folder name used in this repo.
   - Team: the app's team (`4D2KRG86P2`). Bundle Identifier:
     **`com.mattbrown.therise.watchkitapp`** (Xcode proposes this).
   - Interface SwiftUI, language Swift. Untick *Include Notification Scene*,
     *Include Complication* and *Include Tests*.
   - Activate the new scheme when asked, then switch back to `TheRise`.
3. **Deployment target and versions.** In the Watch target's Build Settings:
   `WATCHOS_DEPLOYMENT_TARGET = 10.0`, `SWIFT_VERSION = 5.0`,
   `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` equal to the app's
   (`scripts/verify-release-readiness.py` reads every
   `CURRENT_PROJECT_VERSION` in the project and requires them all to match).
4. **Replace the template.** Delete the files Xcode generated in the
   `TheRiseWatch Watch App` group (`TheRiseWatchApp.swift`,
   `ContentView.swift`, `Assets.xcassets`, *Preview Content* if you do not
   want it) - Move to Trash. Then right-click the group > *Add Files to
   "TheRise"...*, select everything in
   `ios/TheRiseWatch/TheRiseWatch Watch App/` (the six Swift files,
   `Info.plist`, `PrivacyInfo.xcprivacy`, `Assets.xcassets`), **untick Copy
   items if needed**, tick target **TheRiseWatch Watch App only**. Check that
   `Info.plist` is *not* in Copy Bundle Resources, and that
   `PrivacyInfo.xcprivacy` and `Assets.xcassets` are.
5. **Info.plist.** In the Watch target's Build Settings set
   `INFOPLIST_FILE = ../TheRiseWatch/TheRiseWatch Watch App/Info.plist`
   (relative to `ios/TheRise/`). It carries `WKApplication = YES`,
   `WKCompanionAppBundleIdentifier = com.mattbrown.therise`,
   `WKRunsIndependentlyOfCompanionApp = NO` and
   `NSLocationWhenInUseUsageDescription`. Leaving `GENERATE_INFOPLIST_FILE`
   on is fine; delete any `INFOPLIST_KEY_*` build setting that disagrees.
   `WKRunsIndependentlyOfCompanionApp = NO` means the Watch app is installed
   with the iPhone app (the journal lives on the iPhone). It does **not**
   stop the Watch app working without the phone nearby.
6. **Share the model file.** Select `TheRise/RiseWatchModels.swift` in the
   navigator; in the File inspector under Target Membership tick **both**
   `TheRise` and `TheRiseWatch Watch App`. `RiseWatchBridge.swift` stays
   `TheRise` only.
7. **Embedding.** Xcode adds an *Embed Watch Content* build phase to
   `TheRise` (destination `$(CONTENTS_FOLDER_PATH)/Watch`) and a target
   dependency. Confirm both are there.
8. **Capabilities.** None. WatchConnectivity needs no entitlement; no App
   Group is used (the Watch keeps its own files and gets everything over
   WatchConnectivity); no background modes. Location is When In Use only.
9. **Signing.** Automatic signing creates the App ID
   `com.mattbrown.therise.watchkitapp`. With manual profiles, create an App
   Store profile for it and select it for Release.
10. **Build.** Build `TheRise` for an iPhone simulator that has a paired
    Watch simulator, then run the `TheRiseWatch Watch App` scheme on the
    Watch simulator. Fix compile errors (see the warning at the top).
    `scripts/test-rise-store.sh` now also compiles and tests
    `RiseWatchModels.swift`; run it on the Mac.
11. **Release checks.** `python3 scripts/verify-release-readiness.py
    --online`. Consider adding checks that the Watch target exists and its
    versions match, once it does.

## App Store Connect

- The Watch app ships **inside the iPhone app's binary**. There is no
  separate submission; upload the iPhone archive as usual and the Watch app
  comes with it.
- After the build processes, the version page gets an **Apple Watch** section.
  App Review requires Watch screenshots there: at least one set at an
  accepted size (for example Series 9 45 mm, 396 x 484, or Ultra 2,
  410 x 502). `scripts/create-app-store-screenshots.mjs` does not make them;
  take them from the Watch simulator.
- The Watch icon comes from the binary's asset catalog (the iPhone icon at
  1024 px, no alpha).
- Privacy "nutrition label": unchanged. Nothing is collected; catches move
  only between the user's own devices over WatchConnectivity, and location is
  not stored. `docs/privacy.html` says so.
- Review notes (`app-store-metadata/en-US/review-notes.txt`): say that the
  Watch app needs The Rise opened once on the paired iPhone to receive its
  waters, and how to log a catch (a water > Fish on!).

## Test checklist (real devices)

- [ ] Fresh Watch install, iPhone app never opened: the Watch says "Open The
      Rise on your iPhone once to send today's waters." and nothing crashes.
- [ ] Open The Rise on the iPhone: within a few seconds the Watch lists home,
      saved and top-pick waters with scores and "as of".
- [ ] Each water shows the countdown, flow and temperature with provenance
      and age, next fly, Not working cycling, the best planner day if the
      planner was loaded.
- [ ] **Phone in airplane mode, or left at home.** Watch Wi-Fi/cellular off
      too. Open the Watch app: everything above still shows, from the pack.
- [ ] **Fish on! offline**: haptic, "Logged 9:41 AM", Undo counts down from
      8; Undo removes it; log another and add length with the Crown and a
      species. "Unsynced: 1", "Today: 1 on this Watch".
- [ ] Force-quit the Watch app during the details sheet; reopen: the catch is
      still there, still unsynced.
- [ ] **Reconnect** (airplane mode off, phone in range) with The Rise open on
      the phone: the catch appears **once** in the journal, in time order,
      marked "Logged on Apple Watch", with the readings' provenance as the
      Watch stamped them; the Watch's Unsynced count falls to 0.
- [ ] **Kill the phone app**, log a catch on the Watch, reconnect, wait,
      then launch The Rise: the catch is added on launch, once.
- [ ] Deliver the same catch twice (e.g. reinstall the Watch app mid-sync):
      still one entry.
- [ ] Fill the phone's storage until a journal save fails, then deliver a
      catch: a notice on the Log screen, no entry, the catch still held
      (`watch-pending-catches.json`), added on a later launch once there is
      space.
- [ ] Open an Edit form on the Log screen, then deliver a Watch catch: the
      form still edits the same catch.
- [ ] Watch with its own LTE: open a gauged water; the reading turns
      "measured just now" if USGS answers, and stays on the pack's reading if
      it does not.
- [ ] "Which water am I on?" on the bank of a pack water, and somewhere more
      than two miles from all of them.
- [ ] iPhone with no paired Watch: the app behaves exactly as before; no
      errors in the console from WatchConnectivity.

## Deliberately not in this change

- **Complications / Smart Stack widget.** A WidgetKit extension for the Watch
  (countdown, next fly) is a separate target; the Live Activity plan in
  `on-the-water-native.md` already reaches the Smart Stack on watchOS 11.
- **Pro gating on the Watch.** Nothing on the Watch is a Pro feature today
  (flow history, the rating breakdown, the staged plan and hatch ID are not
  on the Watch), so there is nothing to gate. If a Pro feature is added,
  carry `proAccessActive` in the pack.
- **Watch screenshots** for App Store Connect.
- **Fly feedback back to the phone.** "Not working" on the Watch cycles the
  list for the session; it does not mark the fly ignored in the phone's fly
  feedback. A Watch catch does mark its fly "worked" on the phone when it
  lands, as Fish on! does.
- **Editing a sent catch on the Watch.** After it is sealed, edit it on the
  phone.
- **Photos and notes** on the Watch.
- **Planner fetching on the Watch.** It shows the week only if the phone
  loaded it.
