# The Rise

A fly-fishing companion app for Central Oregon waters. The app is a single HTML
file rendered in a `WKWebView`; the native shell handles RevenueCat, network
fetches, and durable storage for the catch journal.

## Run locally

Serve this folder and open `the-rise-app.html`.

```bash
python3 -m http.server 4877
```

Then visit:

```text
http://127.0.0.1:4877/the-rise-app.html
```

## App Store pages

The App Store Connect marketing and support pages live in `docs/`.

Recommended GitHub Pages settings:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

Expected URLs after GitHub Pages is enabled:

- Marketing URL: `https://mattbrown0406.github.io/TheRise/`
- Support URL: `https://mattbrown0406.github.io/TheRise/support.html`
- Privacy Policy URL: `https://mattbrown0406.github.io/TheRise/privacy.html`
- Terms of Use URL: `https://mattbrown0406.github.io/TheRise/terms.html`
- Apple Standard EULA URL: `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`

## Tests

Behaviour tests run the app script against a stub DOM and assert on scoring,
seasonality, data provenance, and catch-log durability:

```bash
node scripts/test-app-logic.mjs
```

## App Store release checks

Run the deterministic pre-build checks, including live legal-link validation:

```bash
python3 scripts/verify-release-readiness.py --online
```

The release checks run the behaviour tests too. Screenshot freshness can only be
verified on macOS, because `scripts/create-app-store-screenshots.mjs` shells out
to Chrome and ImageMagick at hardcoded macOS paths. On other machines:

```bash
python3 scripts/verify-release-readiness.py --skip-screenshots
```

Any change to `the-rise-app.html` invalidates the App Store screenshots. Rerun
the generator on macOS before submitting.

## Data honesty

Only 14 waters have a live feed and only 6 have a USGS gauge. Every reading is
labelled `measured` or `reference` in the UI, and waters with no feed carry an
explicit notice. Do not add a water to `waterSeed` and present its numbers as
current unless it also has an entry in `liveSources`.

Coordinates live in `waterCoordinates` only. `liveSources` must never hold a
second copy; the release checks fail if it does.

## What Pro unlocks

`proAccessActive` gates flow history, the rating breakdown, the staged fish
plan, and the hatch ID assistant. The paywall copy, the App Store description,
and the subscription product descriptions must not claim anything beyond what is
gated — the release checks fail on the word "alert", because the app sends no
notifications.

The App Store Connect metadata, in-app purchase submission steps, reviewer notes,
and rejection-response copy for version 1.0 build 5 are in
[`docs/app-store-review.md`](docs/app-store-review.md).

## RevenueCat setup

The RevenueCat entitlement identifier is intentionally:

```text
The Rise Pro
```

RevenueCat will not allow renaming the original entitlement identifier, so keep the app code matched to that exact value. The product identifiers are:

```text
therise_pro_monthly
therise_pro_annual
```

The expected current offering identifier is:

```text
default
```
