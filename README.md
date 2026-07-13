# The Rise

A prototype fly-fishing companion app for Central Oregon waters.

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
