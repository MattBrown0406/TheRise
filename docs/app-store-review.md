# App Store review checklist — Version 1.0 (Build 5)

This document covers the July 21, 2026 rejection for submission `80533227-abed-4218-b443-1cdef4bc50c7`.

## Code fixes in build 5

- The catch-photo file input now has the required iOS camera and photo-library usage descriptions in the built `Info.plist`.
- The location feature also has its required when-in-use description.
- The Pro screen displays the subscription title, period, StoreKit/RevenueCat localized price (with the configured U.S. price as a temporary fallback), auto-renewal and cancellation disclosure, Restore Purchases, Privacy Policy, and Apple Standard EULA before purchase.
- Privacy and EULA links open as external web links from the native app.

## App Store Connect metadata

### Privacy Policy URL field

```text
https://mattbrown0406.github.io/TheRise/privacy.html
```

### App Description addition

Add this exact line to every App Description localization for version 1.0:

```text
Terms of Use (Apple Standard EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### App Review Information notes

```text
The July 21 rejection issues are addressed in version 1.0 build 5.

PHOTO PICKER CRASH
To test the corrected catch-photo flow:
1. Launch The Rise.
2. Tap Log.
3. Tap New Entry.
4. Tap Choose File in the Photo field.
5. Choose Take Photo or Photo Library and grant permission when prompted.
6. Select a photo, complete the required catch fields, and save the entry.

Build 5 includes the required NSCameraUsageDescription and NSPhotoLibraryUsageDescription entries. The selected photo remains in the user's local catch journal.

AUTO-RENEWABLE SUBSCRIPTIONS
To locate the subscriptions:
1. Launch The Rise.
2. Tap Pro in the bottom navigation.
3. The screen initially shows The Rise Pro Annual.
4. Tap the Monthly/Annual toggle to display The Rise Pro Monthly.
5. Tap Subscribe Annual or Subscribe Monthly to open Apple's purchase confirmation.

Before purchase, the Pro screen displays the subscription title, duration, localized price, auto-renewal/cancellation terms, Restore Purchases, Privacy Policy, and Terms of Use (EULA).

Privacy Policy:
https://mattbrown0406.github.io/TheRise/privacy.html

Terms of Use (Apple Standard EULA):
https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

The submitted in-app purchase products are:
- therise_pro_monthly
- therise_pro_annual
```

## In-App Purchase submission — required before resubmitting the binary

Apple explicitly reported that the referenced auto-renewable products were not submitted for review. Code cannot correct this App Store Connect state.

For **both** `therise_pro_monthly` and `therise_pro_annual`:

1. Open the product in App Store Connect.
2. Complete all required localization, duration, price, and review information.
3. Upload the required App Review screenshot showing the Pro purchase screen and selected plan.
4. Save the product until its status is **Ready to Submit**.
5. Attach/select both products under version 1.0's **In-App Purchases and Subscriptions** section.
6. Submit both products for review with build 5. Do not submit the binary while either product is still missing required metadata or screenshots.

Regenerated review screenshots are stored in the repository at:

- Monthly: `app-store-screenshots/metadata/iphone-monthly-subscription-6.99.png`
- Annual: `app-store-screenshots/metadata/iphone-annual-subscription-49.99.png`

Also verify before submission:

- The Paid Applications Agreement is active.
- Banking and tax agreements are complete.
- RevenueCat's `default` offering contains `$rc_monthly` → `therise_pro_monthly` and `$rc_annual` → `therise_pro_annual`.
- Both packages load in a sandbox/TestFlight installation.
- The App Store Connect Privacy Policy field contains the URL above.
- The App Description or EULA field contains the Apple Standard EULA link above.

## Reply to App Review after build 5 and the IAPs are submitted

Do not send this reply until the signed build has been installed on a physical iPhone and the complete photo-picker and sandbox-purchase paths below have actually passed.

```text
Hello,

Thank you for the review. We corrected the issues in version 1.0 build 5.

Guideline 2.1(a): The catch-photo flow now includes the required iOS camera and photo-library usage descriptions. We tested opening Choose File, selecting/taking a photo, and saving a catch entry.

Guideline 3.1.2(c): The in-app Pro purchase screen now displays the subscription title, duration, localized price, auto-renewal/cancellation disclosure, Restore Purchases, Privacy Policy, and Terms of Use before purchase. The App Store metadata also includes the Privacy Policy and Apple Standard EULA links.

Privacy Policy:
https://mattbrown0406.github.io/TheRise/privacy.html

Terms of Use (Apple Standard EULA):
https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

Guideline 2.1(b): The monthly and annual auto-renewable subscription products have been completed, attached to version 1.0, and submitted for review with build 5.

The exact reviewer path is included in App Review Information notes. A screen recording demonstrating the corrected photo picker and both subscription plans is attached.

Thank you.
```
