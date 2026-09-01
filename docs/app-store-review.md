# App Store review checklist — Version 1.0 (Build 8)

This document addresses the August 12, 2026 rejection for submission `80533227-abed-4218-b443-1cdef4bc50c7`.

## Rejection root causes confirmed in App Store Connect

The July 24 read-back showed:

- The en-US App Description did not contain a Terms of Use / EULA link.
- App Review notes were stale and said subscription handling would work “once products are configured.”
- Both subscription products were `MISSING_METADATA`.
- Both products already had pricing, territory availability, en-US localizations, and complete 1242×2688 App Review screenshots.
- The shared subscription group had no en-US localization. This incomplete group metadata prevented the products from becoming ready for review.
- Version 1.0 build 7 was submitted without its first auto-renewable subscription products as App Review items. Apple could not review the subscription flow.
- Apple explicitly requested a new binary. Build 8 is the current repository build for resubmission.

## Build 8 app compliance

The in-app Pro screen displays all required information before purchase:

- Subscription title: The Rise Pro Monthly or The Rise Pro Annual
- Subscription length: one month or one year
- Localized StoreKit/RevenueCat price
- Auto-renewal and cancellation disclosure
- Restore Purchases
- Functional Privacy Policy link
- Functional Apple Standard EULA link

The catch-photo path retains the camera, photo-library, and location usage descriptions added in build 5. Build 8 keeps those corrections.

## Versioned App Store metadata

The canonical metadata payloads are stored in:

- `app-store-metadata/en-US/description.txt`
- `app-store-metadata/en-US/review-notes.txt`
- `app-store-metadata/en-US/privacy-url.txt`
- `app-store-metadata/subscriptions.json`

The idempotent App Store Connect sync utility is `scripts/sync-app-store-metadata.rb`. It performs a read-only dry run by default and writes only with `--apply`. It requires `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_PATH` in the environment and stops if either subscription remains `MISSING_METADATA` after read-back.

### Privacy Policy URL field

```text
https://mattbrown0406.github.io/TheRise/privacy.html
```

### App Description addition

```text
Terms of Use (Apple Standard EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

The App Description addition must appear in every active localization. Version 1.0 currently has only en-US.

## Subscription products

Subscription group:

```text
The Rise Pro
```

Products:

```text
The Rise Pro Monthly — therise_pro_monthly — ONE_MONTH
The Rise Pro Annual  — therise_pro_annual  — ONE_YEAR
```

Required App Review screenshot files:

- Monthly: `app-store-screenshots/metadata/iphone-monthly-subscription-6.99.png`
- Annual: `app-store-screenshots/metadata/iphone-annual-subscription-49.99.png`

Both products must be **Ready to Submit** before the new version is submitted. Add the subscription group and both subscriptions as review items with version 1.0 build 9; do not submit only the binary.

## App Store Connect completion order

1. Create the en-US subscription-group localization `The Rise Pro`.
2. Normalize both product display names, descriptions, and review notes from `app-store-metadata/subscriptions.json`.
3. Verify both product screenshots report asset-delivery state `COMPLETE`.
4. Verify both subscriptions transition from `MISSING_METADATA` to `READY_TO_SUBMIT`.
5. Replace the version 1.0 en-US App Description with `app-store-metadata/en-US/description.txt`.
6. Replace App Review notes with `app-store-metadata/en-US/review-notes.txt`.
7. Verify the Privacy Policy URL field matches `app-store-metadata/en-US/privacy-url.txt`.
8. Build and upload version 1.0 build 9.
9. Open **Monetization > Subscriptions > Rise Subscriptions**. Select both products and click **Add for Review**.
10. Add the products to the same draft submission as iOS version 1.0 build 9. Because this is the first subscription group, confirm the group is included too.
11. Open **App Review > Drafts** and verify the draft visibly lists all four items: iOS app version 1.0, Rise Subscriptions, The Rise Pro Monthly, and The Rise Pro Annual.
12. Attach the requested screen recording to the review correspondence and submit the complete review package.

Do not press **Submit for Review** if the draft lists only the app version. The four-item draft check is the release gate that was missed for builds 5 and 7.

## App Review response

Send only after build 9, the subscription group, and both subscriptions have been submitted for review:

```text
Hello,

Thank you for the review. We addressed the outstanding issue in version 1.0 build 9.

Guideline 3.1.2(c): The App Store description now includes the functional Apple Standard EULA link:
https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

The App Store Privacy Policy field contains:
https://mattbrown0406.github.io/TheRise/privacy.html

The in-app Pro screen displays the selected subscription title, duration, localized price, auto-renewal and cancellation disclosure, Restore Purchases, Privacy Policy, and Terms of Use before purchase.

Guideline 2.1(b): The App Review submission now includes iOS version 1.0 build 9, the Rise Subscriptions subscription group, The Rise Pro Monthly (`therise_pro_monthly`), and The Rise Pro Annual (`therise_pro_annual`). Both products include localization, pricing, availability, App Review screenshots, and review notes.

The exact reviewer path is included in App Review Information notes. We also attached the requested screen recording demonstrating both subscription plans and the corrected photo-picker path.

Thank you.
```

## Remaining physical-device gates

Do not claim these passed until they are exercised on a signed physical-device build:

- Camera permission → take photo → save catch
- Photo Library permission → choose photo → save catch
- Monthly sandbox purchase
- Annual sandbox purchase
- Restore Purchases
- Privacy and EULA links opening externally
