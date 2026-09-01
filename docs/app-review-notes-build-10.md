# App Review Notes for The Rise 1.0 (10)

Build 10 carries forward everything in build 9 and fixes six defects found afterwards. Three of them lost user data or would have drawn a rejection.

The App Review submission includes all four required review items:

- iOS app version 1.0, build 10
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

## Build 10 changes

### The catch journal no longer loses entries

Event handlers were attached to every matching element on every render, from 41 call sites, while a render replaced the markup of only one of the seven screens. Handlers accumulated: one Delete tap removed several catches and one Save wrote the same entry several times. All handlers are now delegated once from the document, so repainting cannot multiply them. Build 9 moved the journal into the app container to protect it; build 10 stops the interface from destroying it.

### Catch-log text is escaped

Journal text was interpolated into markup unescaped. A fly name containing a quotation mark was silently truncated on save, a note containing `<` lost everything after it, and script in a note would execute. All journal fields are escaped where they are rendered, and text arriving from USGS, NWS or ODFW is sanitized where it enters the app.

### No demo or prototype language

The window title, the Regulations line on every water, and three status strings described the app as a prototype or a demo. That language is gone, and a release check now fails the build if it returns.

### Local reports: agency sources only

The app previously fetched two commercial fly shop report pages, a guide service and a conservation group, extracted keywords, and presented the result inside a paid subscription. Those four are now listed as links for the angler to read; they are never fetched and never influence a rating.

Only the two public ODFW Central Zone pages are read and parsed, and two extraction defects are fixed with them:

- A source that could not be read now contributes nothing and is named nowhere. The app used to fall back to its own placeholder text, run keyword extraction over it, and credit the result to organizations the device had never contacted.
- Extraction is scoped to the passage that actually names the water, with word-boundary matching. It previously harvested keywords from the whole page, so one page covering three rivers gave all three the same hatches, and "goods" in a page footer read as a positive fishing report.

### Weather requests

A daily open made roughly 124 requests to api.weather.gov, two per water for 62 waters, in bursts of four. The National Weather Service grid a coordinate resolves to is a constant, so it is now looked up once and cached on the device; waters sharing a grid share one forecast fetch; requests are serialized and spaced; and a sync now covers the waters this device actually uses rather than all 62. A measured daily open makes 8 weather requests, and a second sync makes no grid lookups at all.

### Native layer

- `WKUserContentController` retains its message handlers, so registering the view controller directly made it own itself and `deinit` never ran. A weak proxy now sits between them.
- The native fetch bridge relayed any http or https URL the web layer handed it. It is now restricted to https and to the three API hosts the app uses.

## Verification

`python3 scripts/verify-release-readiness.py --online` runs 19 release checks, including three test suites:

- `scripts/test-app-logic.mjs` - 125 checks against the app script.
- `scripts/test-app-dom.mjs` - 31 checks in real Chromium against the real file. The stub DOM used by the logic suite has no event dispatch and no HTML parser, which is why the duplicated-handler and unescaped-markup defects both passed it and shipped in build 9.
- `scripts/test-rise-store.sh` - 27 checks compiled against `RiseStore.swift`.

`RiseViewController.swift` and `RisePhotoSchemeHandler.swift` import UIKit and WebKit and are compiled by Xcode, not by these scripts.
