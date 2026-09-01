# App Review Notes for The Rise 1.0 (8)

This build addresses the August 12, 2026 App Review rejection under Guideline 2.1(b).

The App Review submission includes all four required review items:

- iOS app version 1.0, build 9
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

## Build 9 changes

Build 9 makes the subscription deliver functionality rather than only presenting a purchase screen.

- The Rise Pro now unlocks four in-app features: recorded flow history, the rating breakdown, the staged fish plan, and the hatch ID assistant. Each renders in a locked state before purchase and becomes usable immediately after.
- The app does not send notifications. All claims about stocking alerts and hatch alerts were removed from the app, the App Store description, and both subscription product descriptions.
- Readings now state whether they are measured from USGS/NWS or are seasonal reference values. Waters with no live feed say so explicitly.
- The catch journal is no longer capped, records full dates, stores photos in the app container instead of web storage, and can be exported as CSV.
