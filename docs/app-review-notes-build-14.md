# App Review Notes for The Rise 1.0 (14)

Build 14 carries forward everything in build 13. It is not a defect round: the
seventh audit found nothing new, so this build is the four quality items that
stood between build 13 and a resubmission — how the app fits the screen it is
running on, how big its controls are, what a purchase looks like from the
buyer's side, and what a fresh install does with an empty journal and no data.

The App Review submission includes all four required review items:

- iOS app version 1.0, build 14
- Rise Subscriptions subscription group
- The Rise Pro Monthly (`therise_pro_monthly`)
- The Rise Pro Annual (`therise_pro_annual`)

Both auto-renewable subscriptions include en-US localization, pricing, territory
availability, an App Review screenshot, and product-specific review notes.

Privacy Policy:
https://mattbrown0406.github.io/TheRise/privacy.html

Terms of Use (Apple Standard EULA):
https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

## What a reviewer sees that is new

1. **A fresh install opens with a three-step setup panel** on Today: get today's
   readings, rank waters by distance, log your first catch. Each step carries the
   button that performs it and checks itself off when it is actually done. **Skip**
   removes it permanently.
2. **A completed purchase or restore leaves the Pro screen** and opens Today with
   a "Four things just unlocked" panel above the now-expanded rating breakdown.
   Each row has a button that opens the feature it names. Relaunching as an
   existing subscriber does not replay it.

## Changes in this build

### The app paints the whole window

The web view was pinned to `safeAreaLayoutGuide` over a cream window
background, while the top of the app is teal. On every notched iPhone that put a
~59pt cream band between the status bar and the teal header, and because
`LaunchScreen.storyboard` is teal, launching the app went teal, band, teal.

The web view is now pinned to the view controller's `view` with
`contentInsetAdjustmentBehavior = .never`, the viewport is `viewport-fit=cover`,
and every screen's top block and the tab bar inset themselves with
`env(safe-area-inset-*)`. The scroller's bottom padding grows with the
home-indicator inset so the last catch card is not under the tab bar.

Because the page now runs under the status bar, it tells the container which
glyph colour that screen needs over a new `riseChrome` bridge: light on Today and
Waters, which are teal to the top edge, dark on the four paper screens.

### Every control is at least 44x44pt

A sweep of all six screens found 66 controls under Apple's minimum — the
skill-mode segments at 29px tall, the save-water star at 38x38, Hide at 48x34,
the fly-feedback buttons, the segmented All/Best control. This is an app used
standing in a river with cold wet hands.

The minimum is applied in one block at the end of the stylesheet, with
`min-height` and centring rather than extra padding, so controls that were
already large enough are unchanged. The toggle switch keeps its canonical 54x30
look and extends its hit area past the visual track instead. The DOM suite
measures every control on every screen at 320, 390, 430 and 768pt, with Pro
active so the gated controls are measured too.

### A purchase now looks like it bought something

Before this, a successful purchase left the angler on the Pro tab with a
disabled "Pro active" button and four cards whose chips had changed from "Pro" to
"Active". Three of the four features are panels on other screens that simply
replaced a lock, so nothing on screen looked like the thing they had just paid
for. The app was rejected once under 2.1(b) over exactly that impression.

A purchase or a restore that turns Pro on now moves to Today, scrolls to the
panel, and expands the rating breakdown beneath it — the one unlock that is a
visible change rather than a panel appearing on another screen — with the other
three listed above it and a button to each. Landing on the right tab was not
enough on its own: the Today hero is taller than a 390x844 iPhone screen, so a
panel appended below it sat 1,371px down and the buyer saw the screen they were
already looking at.

Only a purchase or a restore opens the panel: the startup status query that
turns Pro on for a returning subscriber does not, and neither does a cancelled
or failed purchase followed by a later status refresh.

### A fresh install is told what to set up

A first launch landed on Today with no saved location, no cached readings and an
empty journal — none of the three things the app is built on — showing seasonal
reference data with nothing to say a sync had never run. That is also the first
30 seconds of an App Review session.

Three steps, each with the button that performs it and a done state it checks
for itself, so the panel is a record of what is set up rather than a tour that
claims to be finished. An install with none of the three done opens on the panel
rather than at the top of that hero; once any one of them is done the app opens
at the top again. The panel disappears for good when all three are done, or on
**Skip**.

### A long journal renders a page at a time

500 catches took 300–440ms to render on a desktop, and two to three times that
on a phone, every time the Log screen repainted. Forty cards are now in the DOM
at a time with **Show more** adding a page. Nothing is truncated: the fish and
trip counts, the entry indices used by Edit and Delete, and the CSV export all
still run over the whole journal, and the screen says how many of how many it is
showing.

Catch photos are also read off the main thread now. `RisePhotoSchemeHandler` did
one synchronous file read per visible card on the thread WebKit calls it on,
which stuttered scrolling against the file system once a journal had a season of
photos in it. Reads happen on a background queue, only the delivery hops back to
the main thread, and live tasks are tracked so a load cancelled by a card
scrolling away is dropped rather than delivered into a task WebKit has finished
with.

## Verification

`python3 scripts/verify-release-readiness.py --online` runs 37 release checks,
including three test suites:

- `scripts/test-app-logic.mjs` — 180 checks against the app script.
- `scripts/test-app-dom.mjs` — 191 checks in real Chromium against the real
  file, including a simulated notch and home indicator, a touch-target sweep at
  four widths with Pro active, the purchase and relaunch paths, and a 500-entry
  journal.
- `scripts/test-rise-store.sh` — 27 checks compiled against `RiseStore.swift`.

`RiseViewController.swift`, `RisePhotoSchemeHandler.swift` and
`AppDelegate.swift` import UIKit, WebKit and RevenueCat and are compiled by
Xcode, not by these scripts. This build changes the first two.
