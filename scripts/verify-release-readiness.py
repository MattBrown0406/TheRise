#!/usr/bin/env python3
"""Deterministic pre-build checks for The Rise App Store review fixes."""

from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import re
import struct
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "the-rise-app.html"
BUNDLED_WEB = ROOT / "ios/TheRise/TheRise/Web/the-rise-app.html"
PLIST = ROOT / "ios/TheRise/TheRise/Info.plist"
PROJECT = ROOT / "ios/TheRise/TheRise.xcodeproj/project.pbxproj"
SWIFT = ROOT / "ios/TheRise/TheRise/RiseViewController.swift"
SUBSCRIPTIONS = ROOT / "ios/TheRise/TheRise/SubscriptionConfig.swift"
REVIEW_DOC = ROOT / "docs/app-store-review.md"
METADATA_DIR = ROOT / "app-store-metadata/en-US"
APP_DESCRIPTION = METADATA_DIR / "description.txt"
REVIEW_NOTES = METADATA_DIR / "review-notes.txt"
PRIVACY_METADATA = METADATA_DIR / "privacy-url.txt"
SUBSCRIPTION_METADATA = ROOT / "app-store-metadata/subscriptions.json"
METADATA_SYNC_SCRIPT = ROOT / "scripts/sync-app-store-metadata.rb"
SCREENSHOT_SCRIPT = ROOT / "scripts/create-app-store-screenshots.mjs"
SCREENSHOT_MANIFEST = ROOT / "app-store-screenshots/subscription-review-manifest.json"
APP_LOGIC_TESTS = ROOT / "scripts/test-app-logic.mjs"
APP_DOM_TESTS = ROOT / "scripts/test-app-dom.mjs"
STORE_TESTS = ROOT / "scripts/test-rise-store.sh"
STORE_SWIFT = ROOT / "ios/TheRise/TheRise/RiseStore.swift"

PRIVACY_URL = "https://mattbrown0406.github.io/TheRise/privacy.html"
EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_online(url: str) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "TheRiseReleaseCheck/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        require(response.status == 200, f"{url} returned HTTP {response.status}")


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    require(data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR", f"invalid PNG: {path}")
    return struct.unpack(">II", data[16:24])


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--online", action="store_true", help="also verify public legal URLs")
    parser.add_argument(
        "--skip-screenshots",
        action="store_true",
        help="skip App Store screenshot freshness checks (the generator only runs on macOS)",
    )
    args = parser.parse_args()

    web_bytes = WEB.read_bytes()
    bundled_bytes = BUNDLED_WEB.read_bytes()
    require(web_bytes == bundled_bytes, "canonical and iOS-bundled HTML differ")
    web = web_bytes.decode("utf-8")

    with PLIST.open("rb") as handle:
        plist = plistlib.load(handle)
    required_usage_descriptions = {
        "NSCameraUsageDescription": "camera",
        "NSPhotoLibraryUsageDescription": "photo",
        "NSLocationWhenInUseUsageDescription": "location",
    }
    for key, word in required_usage_descriptions.items():
        value = plist.get(key)
        require(isinstance(value, str) and word in value.lower(), f"missing or invalid {key}")

    require('type="file"' in web and 'accept="image/*"' in web, "catch-photo file input is missing")
    require("navigator.geolocation" in web, "location feature contract unexpectedly missing")
    require("const maxDimension = 1600" in web, "catch photos are not bounded before local persistence")
    require('canvas.toDataURL("image/jpeg", .82)' in web, "catch photos are not compressed")
    require("if (!setLogs(nextLogs))" in web, "catch-log storage failures are not handled")

    pro_start = web.index("function renderPro()")
    pro_end = web.index("function hasSubscriptionBridge()", pro_start)
    pro = web[pro_start:pro_end]
    require(
        'let subscriptionPrices = { monthly: null, annual: null };' in web,
        "subscription prices must fail closed until StoreKit supplies localized values",
    )
    for token in (
        "The Rise Pro — ${planLabel}",
        "per ${renewalPeriod}",
        "auto-renewable subscription",
        "renews automatically",
        "Restore Purchases",
        PRIVACY_URL,
        EULA_URL,
        '!priceReady || subscriptionLoading || proAccessActive',
    ):
        require(token in pro, f"subscription screen is missing: {token}")
    require("grid-template-columns: minmax(0, 1fr)" in web, "mobile Pro grid can overflow the viewport")
    require("overflow-wrap: anywhere" in web, "subscription disclosure can overflow horizontally")

    swift = SWIFT.read_text(encoding="utf-8")
    require("localizedPriceString" in swift, "native bridge does not return localized StoreKit prices")
    require("navigationAction.navigationType == .linkActivated" in swift, "external legal links are not handled")
    require("UIApplication.shared.open(url)" in swift, "external legal links do not open")

    config = SUBSCRIPTIONS.read_text(encoding="utf-8")
    for product_id in ("therise_pro_monthly", "therise_pro_annual"):
        require(product_id in config, f"missing RevenueCat product identifier: {product_id}")

    project = PROJECT.read_text(encoding="utf-8")
    build_numbers = re.findall(r"CURRENT_PROJECT_VERSION = ([^;]+);", project)
    versions = re.findall(r"MARKETING_VERSION = ([^;]+);", project)
    require(bool(build_numbers) and set(build_numbers) == {"11"}, f"expected build 11, found {build_numbers}")
    require(bool(versions) and set(versions) == {"1.0"}, f"expected version 1.0, found {versions}")

    review_doc = REVIEW_DOC.read_text(encoding="utf-8")
    for token in (
        "Privacy Policy URL field",
        "App Description addition",
        PRIVACY_URL,
        EULA_URL,
        "therise_pro_monthly",
        "therise_pro_annual",
        "Ready to Submit",
        "App Review screenshot",
    ):
        require(token in review_doc, f"App Store review documentation is missing: {token}")

    description = APP_DESCRIPTION.read_text(encoding="utf-8")
    notes = REVIEW_NOTES.read_text(encoding="utf-8")
    privacy_metadata = PRIVACY_METADATA.read_text(encoding="utf-8").strip()
    subscription_metadata = json.loads(SUBSCRIPTION_METADATA.read_text(encoding="utf-8"))
    require(EULA_URL in description, "App Store description metadata is missing the Standard EULA link")
    require(len(description.strip()) <= 4000, "App Store description exceeds the 4,000-character limit")
    require(len(notes.strip()) <= 4000, "App Review notes exceed the 4,000-character limit")
    require(PRIVACY_URL == privacy_metadata, "Privacy Policy metadata URL is incorrect")
    for token in (
        "Version 1.0 build 11",
        "The Rise Pro Monthly",
        "The Rise Pro Annual",
        "therise_pro_monthly",
        "therise_pro_annual",
        PRIVACY_URL,
        EULA_URL,
    ):
        require(token in notes, f"App Review notes are missing: {token}")
    require(
        "once products are configured" not in notes.lower(),
        "App Review notes still describe subscriptions as unconfigured",
    )
    products = subscription_metadata.get("products", [])
    require(
        {product.get("productId") for product in products} == {"therise_pro_monthly", "therise_pro_annual"},
        "subscription metadata manifest does not contain both products",
    )
    for product in products:
        require(product.get("reviewScreenshot"), f"missing review screenshot mapping for {product.get('productId')}")
        require(product.get("reviewNote"), f"missing review note for {product.get('productId')}")
        require(product.get("displayName"), f"missing display name for {product.get('productId')}")
        require(product.get("description"), f"missing description for {product.get('productId')}")
        require(len(product["displayName"]) <= 30, f"display name exceeds App Store limit for {product.get('productId')}")
        require(len(product["description"]) <= 45, f"description exceeds App Store limit for {product.get('productId')}")
        require(product.get("duration") in {"ONE_MONTH", "ONE_YEAR"}, f"invalid duration for {product.get('productId')}")
        require((ROOT / product["reviewScreenshot"]).is_file(), f"missing review screenshot for {product.get('productId')}")
    metadata_sync = METADATA_SYNC_SCRIPT.read_text(encoding="utf-8")
    for token in (
        "--apply",
        "subscriptionGroupLocalizations",
        "appStoreVersionLocalizations",
        "appStoreReviewDetails",
        "subscriptionLocalizations",
        "MISSING_METADATA",
    ):
        require(token in metadata_sync, f"App Store metadata sync script is missing: {token}")

    screenshot_script = SCREENSHOT_SCRIPT.read_text(encoding="utf-8")
    for token in (
        "generateSubscriptionMetadata",
        "billing=${plan}",
        "metadataDir",
        "subscriptionPrices = fixturePrices",
        "verifySubscriptionLayout",
        "data-screenshot-overflow",
    ):
        require(token in screenshot_script, f"subscription screenshot generator is missing: {token}")
    expected_screenshots = {
        ROOT / "app-store-screenshots/iphone/10-pro-upgrade.png": (1242, 2688),
        ROOT / "app-store-screenshots/ipad/10-pro-upgrade.png": (2064, 2752),
        ROOT / "app-store-screenshots/metadata/iphone-monthly-subscription-6.99.png": (1242, 2688),
        ROOT / "app-store-screenshots/metadata/iphone-annual-subscription-49.99.png": (1242, 2688),
    }
    for path, expected in expected_screenshots.items():
        require(png_dimensions(path) == expected, f"unexpected screenshot dimensions: {path}")
    require(SCREENSHOT_MANIFEST.is_file(), "subscription screenshot freshness manifest is missing")
    manifest = json.loads(SCREENSHOT_MANIFEST.read_text(encoding="utf-8"))
    if args.skip_screenshots:
        print("SKIP: screenshot freshness (rerun scripts/create-app-store-screenshots.mjs on macOS)")
    else:
        require(manifest.get("sourceSha256") == sha256(WEB), "subscription screenshots are stale relative to the app HTML")
        require(manifest.get("generatorSha256") == sha256(SCREENSHOT_SCRIPT), "subscription screenshots are stale relative to the generator")
        output_hashes = manifest.get("outputs", {})
        for path in expected_screenshots:
            relative = path.relative_to(ROOT).as_posix()
            require(output_hashes.get(relative) == sha256(path), f"stale or modified subscription screenshot: {relative}")

    # --- Catch-log durability -------------------------------------------------
    # The journal is the only irreplaceable data in the app. It must not be
    # capped, must not carry photo payloads in localStorage, and must be
    # mirrored outside WebKit's evictable storage.
    require(
        not re.search(r"(nextLogs|logs)\s*=\s*[^;]*\.slice\(0, 8\)", web),
        "the catch log is still truncated to eight entries",
    )
    require('postStoreMessage({ action: "saveLog"' in web, "the catch log is not mirrored to the app container")
    require('action: "savePhoto"' in web, "catch photos are not written to the app container")
    require("window.riseLogRestore" in web, "the catch log cannot be restored after a storage eviction")
    require("loggedAt: now.toISOString()" in web, "catch-log entries do not record a full timestamp")
    require("function exportLog()" in web, "the catch log cannot be exported")

    store_swift = STORE_SWIFT.read_text(encoding="utf-8")
    for token in ("applicationSupportDirectory", "isValidPhotoIdentifier", "func saveLog", "func loadLog"):
        require(token in store_swift, f"native catch-log storage is missing: {token}")
    require(
        "import UIKit" not in store_swift and "import WebKit" not in store_swift,
        "RiseStore must stay Foundation-only so it can be compiled and tested off-device",
    )
    scheme_swift = (ROOT / "ios/TheRise/TheRise/RisePhotoSchemeHandler.swift").read_text(encoding="utf-8")
    require("WKURLSchemeHandler" in scheme_swift, "the catch-photo scheme handler is missing")
    require("RisePhotoSchemeHandler.swift" in project, "RisePhotoSchemeHandler.swift is not in the Xcode target")
    require("riseStore" in swift, "the native store bridge is not registered")
    require("RisePhotoSchemeHandler.scheme" in swift, "the catch-photo scheme handler is not registered")
    require("RiseStore.swift" in project, "RiseStore.swift is not in the Xcode target")

    # --- Subscription honesty -------------------------------------------------
    # Everything the paywall and the store listing claim has to exist in the app.
    require("proAccessActive" in web, "Pro access is not referenced")
    gate_count = len(re.findall(r"if \(!proAccessActive\)", web))
    require(gate_count >= 4, f"Pro unlocks nothing: found {gate_count} gated surfaces, expected at least 4")
    require(
        not re.search(r"stocking alerts|hatch alerts", web, re.IGNORECASE),
        "the app still advertises alerts it cannot send",
    )
    require(
        not re.search(r"\balerts?\b", description, re.IGNORECASE),
        "the App Store description still advertises alerts",
    )
    for product in products:
        require(
            not re.search(r"\balerts?\b", product["description"], re.IGNORECASE),
            f"subscription description still advertises alerts: {product.get('productId')}",
        )

    # --- Data honesty ---------------------------------------------------------
    require("demo cache" not in web, "fabricated cache timestamps are still shown as live data")
    require("function valueProvenance(" in web, "displayed readings do not report their origin")
    require("function waterDataNotice(" in web, "waters without a live feed are not labelled")

    # --- Recommendation inputs ------------------------------------------------
    require("function parseSeasonMonths(" in web, "hatch seasons are still decorative text")
    require("hatchSeasonFit(" in web, "the score ignores what is in season")
    require("flowScoreAdjustment(water)" in web, "the score still ignores flow")
    require("function currentHour(" in web, "the score still ignores the time of day")

    # --- Single source of truth for coordinates -------------------------------
    live_sources_block = web[web.index("const liveSources = {"):web.index("const waterCoordinates = {")]
    require(
        "lat:" not in live_sources_block and "lon:" not in live_sources_block,
        "liveSources holds a second copy of the coordinates it must read from waterCoordinates",
    )

    # --- Shipping language ----------------------------------------------------
    # An app that calls itself a prototype or a demo is a guideline 2.2
    # rejection, and every water's Regulations line used to read "Demo only".
    for label, text in (("app HTML", web), ("bundled app HTML", BUNDLED_WEB.read_text(encoding="utf-8"))):
        require("prototype" not in text.lower(), f"{label} still calls the app a prototype")
        require("demo" not in text.lower(), f"{label} still calls the app a demo")
    require(
        "<title>The Rise - Central Oregon Fly Fishing</title>" in web,
        "the window title is not a shipping title",
    )

    # --- Event binding --------------------------------------------------------
    # bindDynamic() attached a listener to every matching element on every
    # render, so one Delete tap deleted several catches. Handlers are delegated
    # once now, and nothing may reintroduce per-render binding.
    require(
        not re.search(r"^\s*bindDynamic\(\);", web, re.MULTILINE),
        "bindDynamic() is back; handlers must be delegated once, not bound per render",
    )
    require("function bindDelegatedEvents()" in web, "the delegated event binder is missing")
    require(
        len(re.findall(r"bindDelegatedEvents\(\);", web)) == 1,
        "the delegated event binder must be called exactly once",
    )

    # --- Escaping -------------------------------------------------------------
    # Catch-log text reached innerHTML raw: a quote truncated a fly name, a "<"
    # swallowed a note, and script in a note ran inside the WebView.
    require("function esc(value)" in web, "the HTML escaping helper is missing")
    require("function safeText(value" in web, "the network-text sanitiser is missing")
    for field in ("entry.notes", "entry.fly", "entry.fish", "entry.waterName"):
        require(
            f"esc({field})" in web,
            f"catch-log field {field} is interpolated into innerHTML without escaping",
        )
    require("forecast: safeText(" in web, "the NWS forecast string reaches the app unsanitised")

    # --- Third-party reports --------------------------------------------------
    # Reselling a fly shop's read inside a paid subscription is their terms of
    # service and Apple 5.2. The shops are linked, never fetched.
    intel_block = web[web.index("const localIntelSources = ["): web.index("const referenceLinks = [")]
    for host in ("confluenceflyshop", "flyfishersplace", "deschutescamp", "deschutesriveralliance"):
        require(
            host not in intel_block,
            f"{host} is being scraped again; commercial and third-party reports are link-only",
        )
    require("fallback:" not in intel_block, "fallback prose is back; an unreadable source must contribute nothing")
    require(
        "if (!source.readable) return null;" in web,
        "extraction no longer refuses unreadable sources",
    )
    allowed_hosts_block = SWIFT.read_text(encoding="utf-8")
    require(
        "allowedFetchHosts" in allowed_hosts_block,
        "the native fetch bridge has no host allowlist",
    )
    require(
        "RiseScriptMessageProxy" in allowed_hosts_block,
        "script message handlers are registered without the weak proxy; deinit will never run",
    )

    # --- Request volume -------------------------------------------------------
    require("NWS_GRID_CACHE_KEY" in web, "the NWS grid lookup is not cached")
    require("nwsRequestChain" in web, "weather requests are not serialised")
    require("function watersForBulkSync()" in web, "a sync still covers every water")

    # --- iPad layout ----------------------------------------------------------
    # The app ships to iPad. It used to draw a simulated 430px phone at every
    # viewport wider than 600px, and the screenshot harness overrode the shell
    # only for captures, so Apple reviewed a layout no device could render.
    require(
        "@media (min-width: 700px)" in web,
        "the tablet layout is gone; iPad would fall back to the phone layout",
    )
    require(
        "0 0 0 10px #0d0d0c" not in web,
        "the simulated device bezel is back in a shipping build",
    )
    screenshot_generator = SCREENSHOT_SCRIPT.read_text(encoding="utf-8")
    require(
        "screenshot-ipad ." not in screenshot_generator,
        "the screenshot harness is injecting an iPad layout again; the app must own its own layout",
    )

    # --- No invented history --------------------------------------------------
    # A fresh install used to report 34 fish over 11 trips from three demo
    # catches, then persist those catches the first time anything was saved.
    require(
        "const exampleLogs = [" in web and "sampleLogs" not in web,
        "demo catches are back in the journal's data path",
    )
    require(
        "logCache = readLogsFromStorage() || [];" in web,
        "getLogs() no longer returns the user's own journal and only that",
    )
    require(
        not re.search(r"saved \? .*: (34|11)\b", web),
        "the catch journal is showing hardcoded fish or trip counts again",
    )

    # --- A failed sync must report failure -------------------------------------
    require(
        "if (!usgs && !nws) {" in web,
        "a report with no payload can be cached as ready again",
    )
    require(
        "if (mode === \"daily-open\" && anySucceeded) markDailyOpenSyncComplete();" in web,
        "a failed daily-open sync can mark the day complete again and block every retry",
    )

    # --- Alias table ----------------------------------------------------------
    # Three keys were written with spaces where the ids use hyphens, which
    # switched local-report matching off on the Deschutes.
    alias_block = web[web.index("const waterAliasMap = {"): web.index("const waterAliasExclusions = {")]
    require(
        not re.search(r'^\s*"[a-z]+ [a-z]', alias_block, re.MULTILINE),
        "an alias key contains a space; water ids are hyphenated and the key would be dead code",
    )
    require(
        "function waterMentionStrength(" in web,
        "report attribution is back to first-substring-wins; a reservoir report can land on a tailwater",
    )
    require(
        "let boost = 0;" in web,
        "a source earns a score boost again just for naming the water",
    )

    # --- Journal integrity ----------------------------------------------------
    require(
        "current.length >= parsed.length" not in web,
        "the container backup compares row counts again and can delete real catches",
    )
    require(
        "function scrollAppToTop()" in web,
        "tab switching scrolls the document again, which is not the app's scroller",
    )
    require(
        "function loggedReadingLabel(" in web and '"Flow source"' in web,
        "logged readings are displayed and exported without saying where they came from",
    )

    # --- Screen reachability --------------------------------------------------
    # The knots screen shipped for eleven builds rendered on every launch with
    # nothing anywhere that could open it, while the review notes told Apple it
    # was there. A screen the reviewer cannot reach is a 2.1 rejection, so every
    # section must be openable from a tab or a jump, and the knots feature —
    # scrapped by Matt on 2026-09-01 — must be gone from the app and the
    # metadata rather than merely unreachable.
    sections = set(re.findall(r'<section id="([a-z-]+)" class="view', web))
    reachable = set(re.findall(r'data-tab="([a-z-]+)"', web)) | set(
        re.findall(r'data-tab-jump="([a-z-]+)"', web)
    )
    require(bool(sections), "no app screens found; the section markup changed shape")
    unreachable = sorted(sections - reachable)
    require(not unreachable, f"screens the user cannot open: {', '.join(unreachable)}")
    require(
        not (reachable - sections),
        f"tabs pointing at screens that do not exist: {', '.join(sorted(reachable - sections))}",
    )
    knot_sources = {
        "the-rise-app.html": web,
        "review-notes.txt": REVIEW_NOTES.read_text(encoding="utf-8"),
        "description.txt": APP_DESCRIPTION.read_text(encoding="utf-8"),
        "create-app-store-screenshots.mjs": SCREENSHOT_SCRIPT.read_text(encoding="utf-8"),
        "test-app-dom.mjs": APP_DOM_TESTS.read_text(encoding="utf-8"),
        "test-app-logic.mjs": APP_LOGIC_TESTS.read_text(encoding="utf-8"),
    }
    for name, text in knot_sources.items():
        require("knot" not in text.lower(), f"the scrapped knots feature is back in {name}")

    # --- Behaviour suite ------------------------------------------------------
    require(APP_LOGIC_TESTS.is_file(), "app behaviour tests are missing")
    result = subprocess.run(
        ["node", str(APP_LOGIC_TESTS)],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if result.returncode != 0:
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
    require(result.returncode == 0, "app behaviour tests failed")
    logic_summary = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "no output"

    require(APP_DOM_TESTS.is_file(), "real-DOM tests are missing")
    dom_result = subprocess.run(
        ["node", str(APP_DOM_TESTS)],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if dom_result.returncode != 0:
        sys.stdout.write(dom_result.stdout)
        sys.stderr.write(dom_result.stderr)
    require(dom_result.returncode == 0, "real-DOM tests failed")
    dom_summary = dom_result.stdout.strip().splitlines()[-1] if dom_result.stdout.strip() else "no output"

    require(STORE_TESTS.is_file(), "native storage tests are missing")
    store_result = subprocess.run(
        ["bash", str(STORE_TESTS)],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if store_result.returncode != 0:
        sys.stdout.write(store_result.stdout)
        sys.stderr.write(store_result.stderr)
    require(store_result.returncode == 0, "native storage tests failed")
    store_summary = store_result.stdout.strip().splitlines()[-1] if store_result.stdout.strip() else "no output"

    if args.online:
        check_online(PRIVACY_URL)
        check_online(EULA_URL)

    print("PASS: web bundle parity")
    print("PASS: protected-resource usage descriptions")
    print("PASS: bounded catch-photo compression and storage failure handling")
    print("PASS: subscription disclosure, legal links, and localized-price bridge")
    if not args.skip_screenshots:
        print("PASS: regenerated Pro and IAP review screenshots")
    print("PASS: version 1.0 build 11 and RevenueCat product identifiers")
    print("PASS: App Store metadata/IAP submission checklist")
    print("PASS: catch-log durability, export, and native container storage")
    print("PASS: subscription claims match shipped functionality")
    print("PASS: data provenance labelling and single-source coordinates")
    print("PASS: season, time-of-day, and flow inputs wired into the score")
    print("PASS: no prototype or demo language in a shipping build")
    print("PASS: delegated event binding, no per-render listener attachment")
    print("PASS: catch-log and network text escaped before rendering")
    print("PASS: agency-only report parsing, commercial reports link-only")
    print("PASS: bounded weather request volume and cached NWS grid lookups")
    print("PASS: real iPad layout in the app, no layout injected at capture time")
    print("PASS: a fresh install has no invented catch history")
    print("PASS: a sync that fetched nothing reports failure and retries")
    print("PASS: alias keys reachable, reports attributed to one water, no boost for being named")
    print("PASS: journal restore, tab scrolling, and logged-reading provenance")
    print("PASS: every screen is reachable from a tab, and the knots feature is gone")
    print(f"PASS: app behaviour tests ({logic_summary})")
    print(f"PASS: real-DOM tests ({dom_summary})")
    print(f"PASS: native storage tests ({store_summary})")
    if args.online:
        print("PASS: public Privacy Policy and Apple Standard EULA URLs")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError, ValueError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
