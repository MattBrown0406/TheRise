# App Review Notes for The Rise 1.0 (12)

Build 12 carries forward everything in build 11, removes the knots feature, and fixes nine defects found in a fourth audit. One was an App Review exposure, three put invented or expired data in front of the angler as fact, and two lost or duplicated the angler's own catches.

The App Review submission includes all four required review items:

- iOS app version 1.0, build 12
- Rise Subscriptions subscription group
- The Rise Pro Monthly (`therise_pro_monthly`)
- The Rise Pro Annual (`therise_pro_annual`)

Both auto-renewable subscriptions include en-US localization, pricing, territory availability, an App Review screenshot, and product-specific review notes.

Reviewer path:

1. Launch The Rise. No account is required.
2. Tap Pro in the bottom navigation.
3. Use the Monthly / Annual toggle to review either subscription.
4. Tap Subscribe Monthly or Subscribe Annual to open Apple's purchase confirmation.
5. Tap Restore Purchases to verify restore access.

Before purchase, the Pro screen displays the selected subscription title, duration, localized App Store price, auto-renewal and cancellation disclosure, Restore Purchases, Privacy Policy, and Terms of Use.

Privacy Policy:
https://mattbrown0406.github.io/TheRise/privacy.html

Terms of Use (Apple Standard EULA):
https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

Support:
https://mattbrown0406.github.io/TheRise/support.html

## Build 12 changes

### The knots feature is removed

Earlier builds rendered a knots screen on every launch — five knots with hand-drawn step-by-step SVG boards — that no tab, no jump and no code path could open, while the review notes told App Review the feature was there. The feature has been withdrawn rather than wired up: the screen, its data, its instruction boards, its handlers, its stylesheet rules and every mention of it in the app copy and the review notes are gone.

The release check now proves the general case: every screen section must be openable from a tab or a jump, and no tab may point at a screen that does not exist.

### Readings expire instead of ageing into fiction

A cached report was hydrated as "ready" no matter how old it was, and every reading in it was labelled "measured" at any age. A gauge reading taken in July was still presented in September as a current measurement, still scored as live data, and was stamped onto a catch logged that day as the conditions the fish was caught in.

Readings now age. Under 12 hours they are current. Up to a week they are shown as measured, with how long ago. Past a week they are dropped from the cache at launch and the water falls back to its seasonal reference values, which is what the app can honestly say it knows. Local fishing reports expire after ten days on the same principle, so a month-old report can no longer raise a rating. Saved timestamps now carry the year and, past a day, the age.

A saved location expired on the same reasoning: a months-old fix was used forever as the angler's current position, reporting a distance and applying a proximity penalty to every water. A fix older than 12 hours is discarded and asked for again.

### Editing a catch no longer rewrites the conditions it was caught in

Editing an entry rebuilt every field from the current moment, so correcting a typo in the notes replaced a measured April flow and water temperature with today's values — usually the seasonal reference number, recorded against an April date. Flow, water temperature and their sources are captured when the catch is logged and are never rewritten by a later edit.

### One tap on Save writes one catch

Saving awaits the photo decode, which is a real second or two on a large JPEG, and nothing prevented a second tap in that window from running the whole save again. Save is now single-entry and the button is disabled while a save is in flight.

Relatedly, replacing a catch photo deleted the old file before the journal write. A storage failure had already destroyed the photo while the entry still pointed at it. The old file is now removed only after the write succeeds, and a failed write cleans up the new one.

### The report parser can read a negative

Condition words were matched against a whole passage with no regard for what was being said about them. "Fishing has not been good" scored as a positive report. "There is no caddis activity yet" put caddis on the card. "Skies will be clear and cold overnight with a good chance of snow" produced clear *water* and a positive fishing report out of a weather forecast.

Reports are now read clause by clause. A clause carrying weather words and nothing about fishing is a forecast and is not read as a report on the water. A negated clause does not assert its insects, and a negated positive is read as the negative report it is rather than as a positive one.

### The search field is escaped, keeps its place, and tells the truth about no matches

The water search input interpolated the query into the value attribute unescaped — the one display site the build 10 escaping pass missed. A search term containing a quote was silently truncated, and an attribute could be injected into the field.

Typing also rebuilt the entire screen, destroying and recreating the focused input on every keystroke, which on iOS is the pattern that dismisses the keyboard. Only the results repaint now; the toolbar and the field are left alone.

A search matching nothing used to fall back to the previously selected water and render it in the hero as "TOP WATER TODAY", directly above a count reading "0 waters". No match now shows no top water.

### Smaller

- A hidden water is no longer offered in the Today screen's home-water list.
- A shipping build no longer logs purchase and customer traffic to the device console; verbose RevenueCat logging is confined to `DEBUG`.
- The DOM suite creates its work directory instead of failing with a bare `ENOENT`.

## Verification

`python3 scripts/verify-release-readiness.py --online` runs 29 release checks, including three test suites:

- `scripts/test-app-logic.mjs` — 170 checks against the app script.
- `scripts/test-app-dom.mjs` — 101 checks in real Chromium against the real file, including iPad viewports, a genuinely fresh install, and the double-tap, edit-preservation and search-field paths added in this build.
- `scripts/test-rise-store.sh` — 27 checks compiled against `RiseStore.swift`.

`RiseViewController.swift`, `RisePhotoSchemeHandler.swift` and `AppDelegate.swift` import UIKit, WebKit and RevenueCat and are compiled by Xcode, not by these scripts.
