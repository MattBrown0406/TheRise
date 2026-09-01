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

No suite needs Xcode, a simulator, or a device. Run all three:

```bash
npm install   # once, for the browser driver the DOM suite uses
npm test
```

App behaviour, run against a stub DOM — scoring, seasonality, data provenance,
catch-log durability, escaping, report parsing:

```bash
node scripts/test-app-logic.mjs
```

Real DOM, run in real Chromium against the real file — event binding, catch-log
editing and deletion, injection, request volume, iPad layout, fresh install:

```bash
node scripts/test-app-dom.mjs
```

The stub DOM has no event dispatch, no bubbling and no HTML parser. A
duplicated-handler bug that deleted several catches per tap, and an unescaped
`innerHTML` bug that truncated fly names, both passed the stub suite and shipped.
Anything about listeners, clicks, parsed markup, computed styles or viewport size
belongs in the DOM suite.

Every page opens in its own browser context. All `file://` pages share one
storage origin, so tests used to inherit each other's journal and water cache —
which made a fresh-install test impossible to write, which is why the
fresh-install path was never tested and shipped inventing a fishing history.
Start a test that cares about first-run state with `openApp`, never with a
reused page.

Chrome or Chromium is found automatically; override with `RISE_CHROME`. Snap
Chromium is confined — it has a private `/tmp` and no access to dot-directories —
so the file under test is staged in a plain directory inside `$HOME`. Override
with `RISE_DOM_TEST_WORKDIR`.

Native storage, compiled and run with any Swift toolchain. `RiseStore` imports
only Foundation for exactly this reason; keep it that way. `RisePhotoSchemeHandler`
holds the WebKit-dependent half:

```bash
scripts/test-rise-store.sh
```

## App Store release checks

Run the deterministic pre-build checks, including live legal-link validation:

```bash
python3 scripts/verify-release-readiness.py --online
```

The release checks run all three test suites.

## App Store screenshots

Any change to `the-rise-app.html` invalidates the screenshots. Regenerate them:

```bash
node scripts/create-app-store-screenshots.mjs
```

The generator finds Chrome or Chromium and ImageMagick automatically on macOS and
Linux; override with `RISE_CHROME` and `RISE_MAGICK`. A sandboxed browser (snap
Chromium) has a private `/tmp` and no access to dot-directories, so point the
working directory at a plain directory inside `$HOME`. A working directory the
browser cannot read fails as `overflow=missing`: the harness never loads, so it
never reports its layout.

```bash
RISE_SCREENSHOT_WORKDIR="$HOME/rise-screenshots" node scripts/create-app-store-screenshots.mjs
```

A slow, snap-confined Chromium cold-starts on every capture because each one uses
its own user data directory. Override the per-launch budget with
`RISE_CHROME_TIMEOUT_MS` if a run times out.

Captures are deterministic: the harness pins the clock to a fixed June evening,
freezes animation, and stages the artwork beside the harness. Two runs produce
byte-identical PNGs, so a changed screenshot always means a changed app.

**The harness must never inject layout.** It used to paint an entire iPad layout
on at capture time that existed nowhere in the app, so the iPad screenshots
submitted to Apple showed a layout no device could render — and the bug the
screenshots were supposed to reveal was the one thing they were hiding. The
harness may pin the clock, freeze animation, set app state and seed storage. If a
capture looks wrong, fix the app. A release check fails on any
`html.screenshot-ipad` layout rule.

If you cannot run the generator, the freshness check can be skipped — but the
screenshots are then stale and must not be submitted:

```bash
python3 scripts/verify-release-readiness.py --skip-screenshots
```

## Event handling

Every handler is delegated once from the document by `bindDelegatedEvents()`, and
every action lives in the `clickActions` table. Do not call `addEventListener`
from a render path. Rendering replaces the markup of one screen at a time, so a
listener attached per render accumulates on the six screens that were not
replaced — that is how one Delete tap came to erase several catches. The release
checks fail if per-render binding returns.

## The page owns the whole window

The web view is pinned to the view controller's `view`, not to
`safeAreaLayoutGuide`, with `contentInsetAdjustmentBehavior = .never` and
`viewport-fit=cover` on the viewport. Every screen's top block and the tab bar
pad themselves with `env(safe-area-inset-*)`, and the scroller's bottom padding
grows with the home-indicator inset. Pinning the web view to the safe area
instead left a ~59pt band of the window's own background above a teal header on
every notched iPhone, and the launch screen is teal, so the app opened teal,
band, teal. The release checks fail if the constraints go back to the safe area.

Today and Waters are teal to the top edge and need light status-bar glyphs; the
other four screens are paper and need dark ones. `activateTab` tells the
container which, over the `riseChrome` bridge. Add a screen and give it a status
bar style there.

## Touch targets

Apple's minimum is 44x44pt and this app is used standing in a river with cold
wet hands. The shared minimum lives in one block at the end of the stylesheet:
each control's own rule still owns its colour, border and radius, and only the
tappable size is set there, with `min-height` and centring so a control that is
already big enough is untouched. The DOM suite measures every button, link,
select, input and summary on all six screens at 320, 390, 430 and 768pt, with
Pro on so the gated controls are measured too, and fails on anything under 44pt.
A control whose visual size must stay small extends its hit area with an
absolutely positioned `::after`, as `.toggle` does.

## Landing on what changed

The Today hero is taller than a phone screen, so switching to Today is not the
same as showing something appended to the body below it: the post-purchase
welcome panel sat 1,371px down an 844px screen and the buyer saw the screen they
were already looking at. Anything that has to be seen after an action calls
`scrollAppTo(selector)`, which measures the target against `<main>` — the
scroller — rather than reading `offsetTop`, because the screens and several of
their panels establish their own containing blocks. The DOM suite asserts on
viewport position, not on the element existing.

## The journal pages, it does not truncate

`LOG_PAGE_SIZE` cards are in the DOM at a time and **Show more** adds a page.
Nothing is ever dropped: the counts, the entry indices used by Edit and Delete,
and the CSV export all run over the whole journal — a card's index is still its
index in `getLogs()`, and it must stay that way or Delete removes a stranger.
Catch photos are read off the main thread in `RisePhotoSchemeHandler`, which
tracks its live tasks so a cancelled load is dropped instead of calling back
into a task WebKit has finished with.

## Escaping

`esc()` escapes text between tags, `attr()` escapes a value inside a quoted
attribute, and `safeText()` sanitizes text arriving off the network where it
enters the app. Everything the user typed and everything a remote body sent goes
through one of them before it reaches `innerHTML`. The release checks name the
catch-log fields specifically.

## Local reports

Only the two public ODFW Central Zone pages are fetched and parsed. The fly
shops, the guide service and the conservation group in `referenceLinks` are
links for the angler; reselling their read inside a paid subscription is their
terms of service and Apple 5.2. Adding any of them back to `localIntelSources`
needs written permission from that business first, and the release checks fail
until then.

A source that could not be read contributes nothing and is named nowhere. There
is no fallback prose, and there must never be again: the app used to run keyword
extraction over its own placeholder text and credit the result to organizations
the device never contacted.

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
