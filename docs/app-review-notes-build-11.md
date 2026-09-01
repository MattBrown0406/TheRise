# App Review Notes for The Rise 1.0 (11)

Build 11 carries forward everything in build 10 and fixes nine defects found afterwards. One would have drawn a rejection on iPad, two put invented data in front of the angler, and one made the app claim it had live conditions when it had fetched nothing.

The App Review submission includes all four required review items:

- iOS app version 1.0, build 11
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

## Build 11 changes

### iPad now gets an iPad layout, and the screenshots show it

The app ships to iPhone and iPad. The stylesheet drew a simulated 430pt-wide phone - rounded corners and a black bezel ring - at any viewport wider than 600px, which is every iPad in every orientation. The full-bleed rule was scoped to `max-width: 600px`, so only phones escaped it.

The App Store screenshot generator hid this by injecting an entire iPad layout at capture time under an `html.screenshot-ipad` selector: full-bleed shell, three-up command grid, four-up pack box, two-column water cards. None of that CSS existed in the app, so the previously submitted iPad screenshots depicted a layout no device could render.

The tablet layout is now part of the app, behind `@media (min-width: 700px)`, and the generator injects no layout of its own. A regression test renders the real file at 810x1080, 1180x820 and 744x1133 and asserts that the shell fills the viewport, carries no simulated corner radius or bezel, and lays the command grid out three-up - while an iPhone viewport still gets the two-up phone layout.

### A fresh install no longer invents a fishing history

An empty journal returned three built-in demo catches, and the stat row reported a hardcoded "34 Fish, 11 Trips" over them. The water detail screen then reported those catches back to the angler in the second person as his own local memory.

It did not stop at display. Every write path persists whatever the journal returned, so the first save or delete on a new device wrote all three demo catches into real storage, mirrored them into the device backup, and exported them in the CSV, permanently indistinguishable from real fish.

The journal now contains only what the angler logged. Counts are computed from it, an empty journal reports zero, and the three illustrations are rendered only in the empty state - visually distinct, labelled as not the angler's catches, with no edit or delete controls, and invisible to the journal, the stat row, local memory and the exporter.

### A sync that fetched nothing reports that it fetched nothing

`Promise.allSettled` never rejects, so a refresh in which both requests failed was assembled as a ready report with two null payloads and written to the offline cache. The app then told an angler about to lose signal that his conditions were live and offline-ready, over a cache written from nothing.

The same path also marked the day's sync complete, so an angler whose first launch of the day was out of signal got no further attempt that day - the checks on returning to the app and on the `online` event both declined.

A report with no payload is now an error, is not cached, and does not mark the day complete. A later launch on the same day still syncs.

### Local report matching on the Deschutes

Three keys in the water alias table were written with spaces where the water ids use hyphens, so the lookup missed them and every alias for the three Deschutes reaches was dead code - including "Deschutes River" itself, which is how agency reports name the water. A release check now fails if any alias key is unreachable.

### A report belongs to the water it names

Attribution matched bare substrings, so "Prineville Reservoir is fishing well for bass" was read onto the Crooked River, a tailwater twenty miles away, because "prineville" is one of its aliases. A passage now belongs to whichever water names it most specifically, is attributed to nobody when two waters tie, and honours an explicit exclusion list (Paulina Creek is not Paulina Lake).

Separately, an agency source used to add a fixed boost to a water's rating before reading a word, so "Metolius River. The campground road is now open for the season." raised the Metolius by being mentioned. The rating now moves only on what the passage actually says, and a passage with no fishing content in it yields no signals and names no source.

### Switching tabs returns to the top

The app scrolls `<main>`, not the document. Tab switching called `window.scrollTo`, which does nothing here, so switching tabs after scrolling to the bottom of Waters landed partway down the next screen.

### The device backup cannot overwrite a live journal

The container backup replaced the journal whenever its copy had more rows in it. A stale backup containing two deleted catches therefore overwrote a live journal containing one real one - deleting the real catch and resurrecting both deleted ones - because three is more than one.

The journal write now records its time, and the backup restores only when local storage has nothing or when the backup is provably newer. If a restore lands while a catch is open for editing, the form is re-pointed at the same catch by timestamp rather than by position, so Update cannot write one catch's edits onto another.

### A logged reading says where it came from

The journal has recorded whether flow and water temperature were measured at a gauge or taken from the app's seasonal reference table since build 9, and every display site discarded it. A catch logged with no signal stored the reference value and printed it as the conditions the fish was caught in. The number and its source now travel together on the card and in two new CSV columns; entries written by earlier builds are labelled "source unknown" rather than guessed at.

### The water search keeps the caret where you put it

The search field restored the caret to the end of the value after every keystroke, so a typo in the middle of a search term could not be fixed. The caret position is now preserved.

## Verification

`python3 scripts/verify-release-readiness.py --online` runs 25 release checks, including three test suites:

- `scripts/test-app-logic.mjs` - 140 checks against the app script.
- `scripts/test-app-dom.mjs` - 79 checks in real Chromium against the real file, now including iPad viewports and a genuinely fresh install. Every page runs in its own browser context; `file://` pages share one storage origin, so the tests used to inherit each other's journal and water cache, which is why the fresh-install path had never been tested.
- `scripts/test-rise-store.sh` - 27 checks compiled against `RiseStore.swift`.

`RiseViewController.swift` and `RisePhotoSchemeHandler.swift` import UIKit and WebKit and are compiled by Xcode, not by these scripts.
