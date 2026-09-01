# App Review Notes for The Rise 1.0 (13)

Build 13 carries forward everything in build 12 and fixes ten defects found in a fifth and sixth audit. Two are App Review exposures on the subscription itself, one changed a water's rating according to where the phone was rather than what the river was doing, and one left a catch on screen that the app had already told the angler it could not save.

The App Review submission includes all four required review items:

- iOS app version 1.0, build 13
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

## What the four subscription features look like on the day of review

The review notes previously sent the reviewer to a control that carried no such label, and to a panel that reported having nothing to show. Both are addressed in this build.

- **Rating breakdown** — Today > tap the rating circle. It is now captioned **"Why this rating?"**. Previously the only affordance was an unlabelled score circle, and nothing on the Today screen carried the words the review notes told a reviewer to look for.
- **Flow history** — Waters > tap a gauged river to expand it > Flow history. The panel holds only readings this device has actually taken, so a first launch shows the one reading just fetched, with its value and the time it was taken. Previously a single reading rendered as "One reading recorded so far", which read as a feature with nothing behind it. The trend charts from the second reading onward. Nothing is pre-loaded and nothing is uploaded.
- **Fish this plan** — Waters > tap any water to expand it > Fish This Plan. Also on Today and Trip.
- **Hatch ID assistant** — Bugs > Hatch ID Assistant.

## Fixes in this build

### The Pro card ran off the right edge of the screen whenever the price was not a price

"Unavailable" and "Loading..." rendered in the 52px price face pushed the hero card 61px past the right edge of a 390pt iPhone, clipping the title, Restore Purchases and the subscription disclosure. "Loading..." is every cold launch, and "Unavailable" is exactly what a reviewer sees if StoreKit is slow or the products are not yet approved. Only a real localized price now gets the large face.

### A water in Oregon is scored on Oregon time

Season and time-of-day were read from the device clock. Every water in this app is in Central Oregon, so the same river at the same instant scored 9.2 on a phone in Bend and 8.4 on a phone in Tokyo, and the prime-window line disagreed about whether the morning had passed. The Deschutes is a destination fishery — the people most likely to be planning a trip are the people whose phone is in the wrong time zone. Everything the app says about when now is, including the date a catch is filed under, is measured on `America/Los_Angeles`.

### Searching the water list no longer retargets the water you chose

Deriving the Waters list reassigned the selected water to the top result whenever the selection fell out of the filter. Typing "todd" after choosing the Lower Deschutes moved a planned trip to Todd Lake, and clearing the search did not move it back. Selection changes only when a card is tapped.

### A catch the app could not save no longer stays in the journal

The in-memory journal was advanced before the write was attempted, so a catch the app had just reported it could not save stayed on screen for the rest of the session and was gone at next launch. An edit was also written directly into the live cache array. Both now change only after a write that landed somewhere.

### A negated list stays negated past the comma

"There is no caddis, mayfly, or stonefly activity" splits on the commas, and only the first fragment carried the "no", so two of the three insects were read as present. Negation now carries across a comma into list continuations and stops at a verb, a full stop, or a contrastive conjunction — "not much is happening, but the caddis are thick" still reads the caddis.

### Nothing is clipped at 320pt

An iPhone SE or mini with Display Zoom enabled renders at 320pt. The Trip hero was 337px wide inside a 320px screen and the right-hand 35px of the Trip screen, including the All Waters button, was cut off; the Waters header overflowed by 17px. Both now reflow.

### A pasted link in a catch note no longer widens the journal

An ODFW report URL in a note is a single unbreakable hundred-character word, and it pushed the whole Log screen wider than the phone. Journal text wraps.

### Smaller

- The catch form no longer pre-fills a length of 17 inches, so the journal records a measurement only when the angler enters one.
- A shipping build no longer describes itself as a "browser mockup" when the purchase bridge is unavailable.
- `the-rise-river.png` is referenced nowhere. It has never been in the repository and is excluded by `.gitignore`, so every launch fired a 404 for it; the hero gradient is the design.

## Verification

`python3 scripts/verify-release-readiness.py --online` runs 31 release checks, including three test suites:

- `scripts/test-app-logic.mjs` — 180 checks against the app script.
- `scripts/test-app-dom.mjs` — 154 checks in real Chromium against the real file, including three device time zones, a 320pt viewport, every Pro price state, and a check that every asset the app references exists.
- `scripts/test-rise-store.sh` — 27 checks compiled against `RiseStore.swift`.

`RiseViewController.swift`, `RisePhotoSchemeHandler.swift` and `AppDelegate.swift` import UIKit, WebKit and RevenueCat and are compiled by Xcode, not by these scripts.
