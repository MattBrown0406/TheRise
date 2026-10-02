# The Rise phone-launch audit — October 2, 2026

## Result and scope

Integrated source review, failure-path regression tests, safe Mac working-tree sync, simulator Debug build/launch, and unsigned generic-iOS Release build completed. This is **not physical-iPhone verification**, a signed distribution build, an App Store submission, or a claim that all bugs are gone.

Baseline: `0cc66b5c9fe19fe41ade86dafb03309ca88e5d80`.
Linux branch: `fix/phone-launch-audit-20261002`, `/root/repos/TheRise`.
Mac working tree: `/Users/mattbrown/Developer/TheRise`.
No push, release, OTA, physical-device installation, or device-data deletion performed. Existing screenshots were not regenerated.

## Reviewed and closed findings

| Finding | Repair / actual verification |
| --- | --- |
| Native startup uses legacy application-owned window instead of scene lifecycle | `AppDelegate.swift` now contains `RiseSceneDelegate`; `Info.plist` explicitly registers it with single-scene behavior. Baseline launch contract fails 5 checks; repaired source passes 9/9, final simulator and generic-device bundles each pass 16/16. Prior baseline crash IPS retained; final iOS 27 simulator launch remains running after 15 seconds. |
| Throwing subscription bridge aborts web startup or leaves checkout busy | Catch bridge throws, clear pending/loading, render retry message; DOM startup test verifies requests still begin without page errors. |
| Subscription error / cached remote text interpreted as markup | Escape subscription messages and normalize cached report/intel strings; DOM tests prove injected elements are absent. |
| Malformed disposable report/flow cache crashes consumers | Validate nested record/array/scalar types and reject invalid samples while retaining valid old optional data. Logic and navigation/render DOM controls pass. |
| Failed journal save / photo decode loses draft | Preserve the actual form and FileList across rerenders; surface decode/read/processing failures; keep drafts and allow retry. DOM tests cover quota, decode rejection, and background repaint. |
| Canceled asynchronous photo work saves a stale draft | Check form lifetime after decoding and after native photo acknowledgment; protect concurrent journal changes and delete only the newly allocated orphan. DOM tests cover cancel/reopen and journal changes during pending native IO. |
| Unsupported/corrupt journal silently becomes empty and overwrites original | Block writes when unreadable, show recovery notice; reject malformed backup rows as a whole rather than filtering them into deletion. Valid legacy arrays remain supported. |
| Restore ignores valid empty journal or trusts invalid timestamps | Restore provably newer empty envelopes; compare parsed finite dates; retain local journal when freshness cannot be proven. |
| Timestamp-only write failure falsely reports lost journal | Treat successful journal write separately from freshness metadata; remove stale marker when possible. DOM test verifies memory/disk agreement. |
| Native message delivery mistaken for journal persistence under quota failure | `setLogs` now requires confirmed synchronous localStorage success, never treats postMessage as disk acknowledgment, and does not mirror a mutation reported as failed. This deliberately fails closed even if the native mirror might have had space. |
| Native photo write can fail silently yet create a journal reference | `RiseStore.savePhoto` returns actual atomic-write success; `RiseViewController` returns a correlated `risePhotoSaveResult`; web awaits acknowledgment with a 5-second timeout before referencing photo. Failure/throw/drop/positive acknowledgment and race tests pass. Before this fix, the injected disk-failure test failed (226/227 DOM checks). |
| Invalid photo payload overwrites existing file | Require JPEG data-URL prefix, decodable base64 and JPEG signature before write. Native tests cover rejection/preservation. This is signature validation, not a full image-decoder validation guarantee. |
| CSV export reports a missing/stale file | Native export returns nil on write failure and presents failure alert. Web says “Export requested” rather than falsely claiming the share sheet opened. Native blocked-path export test passes; throwing bridge DOM test passes. |

## Integrated final gates

- Web logic: **199/199**.
- Chromium real DOM: **230/230**.
- Native Foundation store tests executed on the Mac: **39/39**. Linux's missing-Swift skip is not counted as native verification.
- Source launch contract: **9/9**; baseline read-only contract: **4/9** (expected failure).
- Built launch contract: **16/16 on each final simulator and generic-iOS bundle**.
- `git diff --check`: passes locally and on Mac.
- Xcode **27.0 (27A266a)**; resolved RevenueCat **5.80.3**.
- Final Debug simulator and Release generic-iOS builds: **BUILD SUCCEEDED**, both using `CODE_SIGNING_ALLOWED=NO`.
- Simulator: `TheRise-Audit-0cc66b5`, iOS 27.0, UDID `24237DC7-8B0C-47A7-8955-DAF6FCA6BB0B`.
- Installed/launch bundle: `com.mattbrown.therise`; final PID **80561**, verified running after 15 seconds. This verifies process survival, not every native UI flow.
- Xcode open document read-back: `/Users/mattbrown/Developer/TheRise/ios/TheRise/TheRise.xcodeproj`.
- Canonical HTML, iOS bundled HTML, both built bundles, and installed simulator HTML match SHA-256:
  `a9cbeb93a50b075d865f42980d858a9acc2a490ab732b6d0d0266f423d5ffa67`.

### Browser test environment

The initial parent run failed because Snap Chromium could not create its SingletonLock under the hidden scratch directory. No permissions were loosened and no shared Chrome profile was deleted. Used existing unconfined browser explicitly:

```bash
RISE_CHROME=/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm test
```

### Native commands

```bash
bash scripts/test-rise-store.sh
xcodebuild -project ios/TheRise/TheRise.xcodeproj -scheme TheRise -configuration Debug -destination 'platform=iOS Simulator,id=24237DC7-8B0C-47A7-8955-DAF6FCA6BB0B' -derivedDataPath /Users/mattbrown/.hermes/cache/scratch/therise-final-combined-build CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/TheRise/TheRise.xcodeproj -scheme TheRise -configuration Release -destination 'generic/platform=iOS' -derivedDataPath /Users/mattbrown/.hermes/cache/scratch/therise-final-combined-device-build CODE_SIGNING_ALLOWED=NO build
```

## Safe Mac sync

Before copying, checked HEAD and the entire dirty status: only the user's four display-name/category project settings differed. Preserved original diff, HEAD/status, project file, and all overwritten files at:

`/Users/mattbrown/.hermes/cache/scratch/therise-presync-20261002-132309`

Transferred only 10 explicitly listed source/test files. Never copied `project.pbxproj`. Rechecked concurrent HEAD and exact previous file hashes before the follow-up sync. Read back all 10 hashes after sync and again after build; user `project.pbxproj` remains byte-identical to its pre-sync backup. The report is an additional documentation artifact, not a build input.

## Dependency audit

Actual `npm audit --json`: **8 affected packages (7 high, 1 moderate)**, all in the development-only Puppeteer harness. `npm audit --omit=dev --json`: **0 production npm vulnerabilities**. The shipped HTML/native application does not bundle these Node dependencies. This does not audit Swift/RevenueCat dependencies.

Affected chain: `puppeteer-core`, `@puppeteer/browsers`, `extract-zip`, `proxy-agent`, `pac-proxy-agent`, `get-uri`, `basic-ftp`; moderate `ip-address`. Reported issues concern ZIP symlink traversal, FTP listing regex DoS, and IP-family/oversized-input handling. The current harness launches an already-installed browser; it does not invoke browser archive installation, FTP listing, or a user-supplied PAC URL. This limits demonstrated exposure but does not mean vulnerable dev packages are harmless. npm proposes a major Puppeteer upgrade for most of the chain. No blind upgrade or lockfile rewrite was made; dev dependency modernization remains separate follow-up work.

## Limits and residual risks

- Physical-phone launch, permissions, camera/photo picker, real native storage exhaustion, real share-sheet presentation, and StoreKit purchase/restore were not exercised on a physical device. Simulator process survival and browser doubles do not establish these.
- Journal mirroring remains **best-effort** after a confirmed localStorage write. There is no cross-store transaction / native journal acknowledgment protocol. Photo writes are acknowledged, and a failed local journal write is no longer misrepresented as saved merely because a bridge exists. A native mirror failure followed by WebKit storage loss is still a durability limitation; backup/photo-deletion consistency across such failures is not proven by this audit.
- A physical-device signed build was not produced or installed. The generic-iOS build confirms compilation/linking/resource assembly, not signing or phone execution.
- Existing screenshots predate these changes and are not fresh verification evidence.
- No production service, subscription-account configuration, or exhaustive external live-data behavior audit was performed.

## Evidence artifacts

Local evidence root: `/root/.hermes/cache/scratch/`.

- `therise-integrated-final.log` — final logic/DOM run.
- `therise-ack-red.log` — demonstrated native photo acknowledgment failure before repair.
- `therise-final-store.log` — final 39 native store checks.
- `therise-final-build.log` — final integrated simulator build.
- `therise-final-device-build.log` — final generic-iOS Release build.
- `therise-final-launch.log` — final bundle contracts, install/launch/PID, hashes, Xcode document and Mac status.
- `therise-final-manifest.json` — exact 10 synced source/test hashes.
- `therise-audit.json`, `therise-audit-prod.json` — raw dependency audit.
- `therise-native-evidence/baseline-scene-crash.ips` — prior baseline crash evidence.

Native logs and build directories also exist under `/Users/mattbrown/.hermes/cache/scratch/` on the Mac. No Git commit or push was made; fixes remain available for review in both working trees. The Mac additionally retains the user's original `project.pbxproj` changes.
