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
    require(bool(build_numbers) and set(build_numbers) == {"9"}, f"expected build 9, found {build_numbers}")
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
        "Version 1.0 build 9",
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
    print("PASS: version 1.0 build 9 and RevenueCat product identifiers")
    print("PASS: App Store metadata/IAP submission checklist")
    print("PASS: catch-log durability, export, and native container storage")
    print("PASS: subscription claims match shipped functionality")
    print("PASS: data provenance labelling and single-source coordinates")
    print("PASS: season, time-of-day, and flow inputs wired into the score")
    print(f"PASS: app behaviour tests ({logic_summary})")
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
