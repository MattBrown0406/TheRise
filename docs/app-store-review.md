# App Store review checklist — Version 1.0 (Build 17)

Submission `80533227-abed-4218-b443-1cdef4bc50c7` has now been rejected under
Guideline 2.1(b) for the same reason on build 7 (August 12, 2026) and build 16
(October 12, 2026):

> We are unable to complete the review of the app because one or more of the
> In-App Purchase products have not been submitted for review.

**This is not a defect in the binary.** App Review decides it from App Store
Connect's own records: the app shows subscriptions, and the subscription
products were not items in the submission the build went in with. No code
change can satisfy it. Uploading another binary without attaching the products
produces the same rejection, which is what happened to builds 5, 7 and 16.

## The release gate

Do not press **Submit for Review** unless the submission lists **four items**:

1. iOS App 1.0 (build 17)
2. Rise Subscriptions (subscription group)
3. The Rise Pro Monthly — `therise_pro_monthly`
4. The Rise Pro Annual — `therise_pro_annual`

If it lists only the app version, stop.

## Step by step in App Store Connect

### 1. Upload build 17

In Xcode on the Mac Mini (`~/Developer/TheRise`): select the TheRise target →
**General** → **Identity** → set **Build** to `17` (Apple already has 16) →
**Product → Archive** → **Distribute App** → **App Store Connect**. Wait for the
processing email.

### 2. Make both subscriptions "Ready to Submit"

**Apps → The Rise → Monetization → Subscriptions → Rise Subscriptions.**

- Group page: **App Store Localization** needs en-US, display name
  `The Rise Pro`. A first group without it holds both products back.
- Open each subscription and complete everything the page flags:
  - **App Store Localization** (en-US): display name and description from
    `app-store-metadata/subscriptions.json`.
  - **Subscription Prices** and **Availability**.
  - **Review Information**: the App Review screenshot and the review note
    from `subscriptions.json`. Apple will not accept the product for review
    without the screenshot. Screenshots are in `app-store-screenshots/metadata/`;
    the reviewer uses an iPad, so the `ipad-*` files are the better match:
    - Monthly: `ipad-monthly-subscription-6.99.png` (or `iphone-monthly-subscription-6.99.png`)
    - Annual: `ipad-annual-subscription-49.99.png` (or `iphone-annual-subscription-49.99.png`)

Each subscription's status must read **Ready to Submit**. While any says
**Missing Metadata**, the **Add for Review** button does not appear — which is
the usual reason it "isn't there".

### 3. Put build 17 on the version

**Apps → The Rise → iOS App → 1.0** → **Build** section → select build 17 →
**Save**. Paste `app-store-metadata/en-US/review-notes.txt` into **App Review
Information → Notes**.

If the version page has an **In-App Purchases and Subscriptions** section
(below **Build**), click **Select In-App Purchases or Subscriptions**, tick both
subscriptions, click **Done**, and skip step 4.

### 4. Add the subscriptions to the same submission

Back in **Monetization → Subscriptions → Rise Subscriptions**:

1. Open **The Rise Pro Monthly** → **Add for Review**.
2. Choose the existing draft, or **Create New Submission** with platform **iOS**
   and app version **1.0**.
3. Include the **Rise Subscriptions** group when offered — this is the first
   group, so it must go in the same submission.
4. Repeat for **The Rise Pro Annual**, choosing the **same** draft.

### 5. Check, then submit

Sidebar → **App Review** → open the draft under **Drafts**. Confirm the four
items in the release gate above. Only then **Submit for Review**.

### If it still will not attach

The rejection offers **Request a call to discuss your app's review**. Take it:
an App Review representative can see the account and say which field is
blocking the products. App Store Connect support (**Contact Us** → App Store
Connect → In-App Purchases) can do the same.

## App compliance in the binary

The in-app Pro screen displays, before purchase:

- Subscription title: The Rise Pro Monthly or The Rise Pro Annual
- Subscription length: one month or one year
- Localized StoreKit price (via RevenueCat)
- Auto-renewal and cancellation disclosure
- Restore Purchases
- Functional Privacy Policy and Apple Standard EULA links

Product identifiers in `SubscriptionConfig.swift` match the products:
`therise_pro_monthly`, `therise_pro_annual`; entitlement `The Rise Pro`;
offering `default`.

Builds 16 and 17 adopt the UIScene lifecycle (`RiseSceneDelegate`), which
Xcode 27 / the iOS 27 SDK require for an app to launch.

## Versioned App Store metadata

- `app-store-metadata/en-US/description.txt` — includes the Standard EULA link
- `app-store-metadata/en-US/review-notes.txt`
- `app-store-metadata/en-US/privacy-url.txt`
- `app-store-metadata/subscriptions.json`

### Privacy Policy URL field

App Information → Privacy Policy URL:

```text
https://mattbrown0406.github.io/TheRise/privacy.html
```

### App Description addition

Guideline 3.1.2 requires the Terms of Use in the App Store metadata for an app
with auto-renewable subscriptions. Every active localization's description
(version 1.0 has only en-US) must end with:

```text
Terms of Use (Apple Standard EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

`scripts/sync-app-store-metadata.rb` writes the same values through the App
Store Connect API (dry run by default, `--apply` to write; needs `ASC_KEY_ID`,
`ASC_ISSUER_ID`, `ASC_KEY_PATH`) and stops if either subscription is still
`MISSING_METADATA`.

## Reply to App Review

Send after the four-item submission is in:

```text
Hello,

Thank you for the review. Version 1.0 build 17 is now submitted together with
its In-App Purchases. The submission includes:

- iOS app version 1.0 (build 17)
- The Rise Subscriptions subscription group
- The Rise Pro Monthly (therise_pro_monthly), auto-renewable, one month
- The Rise Pro Annual (therise_pro_annual), auto-renewable, one year

Both subscriptions include en-US localization, pricing, availability, an App
Review screenshot, and review notes. To reach them in the app, tap Pro in the
bottom navigation; the Monthly / Annual toggle switches between the two plans.

Privacy Policy: https://mattbrown0406.github.io/TheRise/privacy.html
Terms of Use (Apple Standard EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/

Thank you.
```

## Before submitting, on a signed device (ideally an iPad)

- Monthly and annual sandbox purchases complete and unlock Pro
- Cancelling the payment sheet reads "Purchase cancelled"
- Restore Purchases
- Camera and Photo Library on a catch
- Privacy and EULA links open externally
