# App Review Notes for The Rise 1.0 (15)

Build 15 answers the August 12, 2026 rejection of submission
`80533227-abed-4218-b443-1cdef4bc50c7` (version 1.0 build 7, reviewed on an
iPad Air 11-inch (M3)) under Guideline 2.1(b): the In-App Purchase products had
not been submitted for review.

That rejection is fixed in App Store Connect, not in code. The binary's part is
to be new, to sell exactly the two products being submitted, and to carry
current App Review screenshots for both. The submission must contain all four
review items:

- iOS app version 1.0, build 15
- Rise Subscriptions subscription group (en-US group localization "The Rise Pro")
- The Rise Pro Monthly (`therise_pro_monthly`), one month
- The Rise Pro Annual (`therise_pro_annual`), one year

The step-by-step App Store Connect order is in
[`app-store-review.md`](app-store-review.md). The App Review notes to paste are
`app-store-metadata/en-US/review-notes.txt`.

## Subscription review screenshots

Regenerated from this build's HTML:

- `app-store-screenshots/metadata/iphone-monthly-subscription-6.99.png` (1242x2688)
- `app-store-screenshots/metadata/iphone-annual-subscription-49.99.png` (1242x2688)

Each shows the plan title, duration, price, the auto-renewal and cancellation
disclosure, Restore Purchases, Privacy Policy and Terms of Use (EULA). They used
to carry a harness-only status line ("Purchases are ready in the iOS app
build.") that no device shows; they now show the line a non-subscriber actually
sees, "The Rise Pro is not active yet."

The store screenshots were regenerated with the clock pinned to 9:15 AM Pacific
on a June morning. The caddis season fix in this build moves the Lower
Deschutes prime window to 8-11 AM in mid-June, and the old 7:15 PM pin read
"passed for today" on the first screenshot.

## What changed in the binary

The subscription path:

- A dismissed payment sheet reads "Purchase cancelled." RevenueCat's async
  purchase API reports it by throwing, so it used to read "Purchase failed.
  Please try again."
- An error or cancelled reply no longer turns Pro off. A Restore tapped with no
  signal used to lock an active subscriber out until relaunch.
- Subscription status is re-checked when the app returns to the foreground.

Reviewer-visible:

- The catch-photo field offers Camera and Photo Library. `capture` had forced
  the camera, contradicting both the form and these review notes.
- Form fields are at least 16px, so iPad and iPhone no longer zoom the page in
  when a field takes focus.
- The app reloads itself if iOS terminates the web content process, instead of
  sitting on a blank screen.

Catch log and live data: edit and delete no longer land on the wrong catch;
editing an old entry keeps its water, species, date and readings; USGS no-data
values and stale sensor readings are not shown as measurements; Caddis is in
season from April; report text is decoded before it is read; waters without a
live feed no longer show live weather labelled as reference.

## Verification

- `scripts/test-app-logic.mjs` — 193 checks.
- `scripts/test-rise-store.sh` — 27 checks.
- `python3 scripts/verify-release-readiness.py` — the static checks and the
  subscription screenshot freshness check.
- `scripts/test-app-dom.mjs` must be run on a machine where headless Chrome
  starts; it was not run for this build.

Before submitting, exercise on a signed device: monthly and annual sandbox
purchases, cancelling the payment sheet, Restore Purchases, Camera and Photo
Library on a catch, and the Privacy and EULA links.
