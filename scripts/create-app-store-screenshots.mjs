import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const generatorPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(generatorPath), "..");
const sourceHtml = resolve(root, "the-rise-app.html");
// Chrome writes the harness and raw frames here. Snap-packaged Chromium on
// Linux runs confined: it has a private /tmp, and its home interface does not
// cover dot-directories, so it can read neither /tmp nor a checkout under a
// hidden path. Point RISE_SCREENSHOT_WORKDIR at a plain directory inside $HOME
// (see README); the finished PNGs always land back in the repo.
// A workdir Chrome cannot read fails as `overflow=missing`, because the harness
// never loads and so never reports its layout.
const workRoot = process.env.RISE_SCREENSHOT_WORKDIR
  ? resolve(process.env.RISE_SCREENSHOT_WORKDIR)
  : resolve(root, "app-store-screenshots");
const tmpDir = resolve(workRoot, "tmp");
const rawDir = resolve(workRoot, "raw");
const iphoneDir = resolve(root, "app-store-screenshots/iphone");
const ipadDir = resolve(root, "app-store-screenshots/ipad");
const metadataDir = resolve(root, "app-store-screenshots/metadata");
const subscriptionManifestPath = resolve(root, "app-store-screenshots/subscription-review-manifest.json");
const harnessPath = resolve(tmpDir, "the-rise-screenshot-harness.html");

// Resolved at run time instead of hardcoded to one machine's layout.
// Override with RISE_CHROME / RISE_MAGICK.
const chromeCandidates = [
  process.env.RISE_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium"
].filter(Boolean);

const magickCandidates = [
  process.env.RISE_MAGICK,
  "/opt/homebrew/bin/magick",
  "/usr/local/bin/magick",
  "/usr/bin/magick",
  "/usr/bin/convert"
].filter(Boolean);

function resolveBinary(candidates, label, envVar) {
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`${label} not found. Tried:\n  ${candidates.join("\n  ")}\nSet ${envVar} to override.`);
  }
  return found;
}

const chrome = resolveBinary(chromeCandidates, "Chrome or Chromium", "RISE_CHROME");

// Chromium refuses to start as root without --no-sandbox. CI images and
// containers routinely run as root; developer machines do not and keep the
// sandbox.
const needsNoSandbox = process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0;

const baseChromeFlags = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-extensions",
  ...(needsNoSandbox ? ["--no-sandbox", "--disable-dev-shm-usage"] : [])
];
const magick = resolveBinary(magickCandidates, "ImageMagick", "RISE_MAGICK");

// A snap-confined Chromium cold-starts far slower than a Homebrew one, and each
// capture uses its own user-data-dir, so every launch is a cold start. The old
// 3s DOM-dump budget was a machine-specific assumption that failed here.
// Override with RISE_CHROME_TIMEOUT_MS.
const chromeTimeoutMs = Number(process.env.RISE_CHROME_TIMEOUT_MS) || 60000;

const shots = [
  ["01-today-command-center", "today"],
  ["02-rating-breakdown", "today-score"],
  ["03-ranked-waters", "waters"],
  ["04-water-detail-fly-picks", "waters-detail"],
  ["05-trip-mode", "trip"],
  ["06-pack-my-fly-box", "pack"],
  ["07-bug-life-stages", "bugs"],
  ["08-fly-imitation-library", "bugs-barr"],
  ["09-catch-log", "log"],
  ["10-pro-upgrade", "pro"]
];

const screenshotCss = `
<style id="app-store-screenshot-css">
  /* Screens fade in on render. Chrome captures as soon as the harness signals
     ready, which raced the animation and produced washed-out frames. Freeze all
     motion so every capture is deterministic. */
  html.screenshot-mode,
  html.screenshot-mode body,
  html.screenshot-mode *,
  html.screenshot-mode *::before,
  html.screenshot-mode *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }

  html.screenshot-mode,
  html.screenshot-mode body {
    width: 100%;
    min-height: 100%;
    margin: 0;
    padding: 0 !important;
    display: block !important;
    place-items: initial !important;
    overflow: hidden;
    background: #f8f5ed !important;
  }
  html.screenshot-mode .app-shell {
    width: 100vw !important;
    height: 100vh !important;
    min-height: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: hidden !important;
    background: #f8f5ed !important;
  }
  /* Height only. The bottom padding that clears the tab bar is the app's own
     (88px phone, 104px tablet) and must not be restated here. */
  html.screenshot-mode main {
    height: 100vh !important;
    overflow-y: auto !important;
  }
  html.screenshot-mode .footer-tabs {
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
  }
  /* There is deliberately no html.screenshot-ipad layout here.

     This harness used to inject an entire iPad layout at capture time -
     full-bleed shell, three-up command grid, four-up pack box, two-column
     water cards - none of which existed in the app. The screenshots submitted
     to Apple showed a layout no device could render. That layout now lives in
     the-rise-app.html behind @media (min-width: 700px), and the harness only
     freezes animation and pins the clock. If a capture looks wrong, the app
     is wrong. */
</style>`;

const screenshotClock = `
<script id="app-store-screenshot-clock">
  // The app now scores on the real month and hour, so screenshots would change
  // depending on when they were generated. Pin the clock to a June morning so
  // captures are deterministic. June evening is inside the prime window for the
  // waters shown, so the screenshots depict a real, representative state.
  (function () {
    var FIXED = new Date("2026-06-15T19:15:00").getTime();
    var RealDate = Date;
    function PinnedDate() {
      if (arguments.length === 0) return new RealDate(FIXED);
      return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
    }
    PinnedDate.prototype = RealDate.prototype;
    PinnedDate.now = function () { return FIXED; };
    PinnedDate.parse = RealDate.parse;
    PinnedDate.UTC = RealDate.UTC;
    window.Date = PinnedDate;
  })();
</script>`;

const screenshotJs = `
<script id="app-store-screenshot-js">
  document.documentElement.classList.add("screenshot-mode", "screenshot-" + (new URLSearchParams(location.search).get("device") || "iphone"));
  const fixturePrices = { monthly: "$6.99", annual: "$49.99" };
  const subscriptionOverflow = () => {
    const viewportWidth = document.documentElement.clientWidth;
    const selectors = ["#pro", ".pro-layout", ".pro-hero", ".pro-actions", ".subscription-disclosure", ".subscription-disclosure p"];
    const offenders = selectors.filter((selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > viewportWidth + 1 || element.scrollWidth > element.clientWidth + 1;
    });
    if (document.documentElement.scrollWidth > viewportWidth + 1) offenders.push("html");
    return offenders.length ? offenders.join(",") : "none";
  };
  window.addEventListener("load", () => {
    const params = new URLSearchParams(location.search);
    const shot = params.get("shot") || "today";
    // Shots that exist to show a Pro feature are captured with Pro active,
    // otherwise the store listing would advertise a locked panel.
    const proShots = ["today-score", "waters-detail", "trip", "bugs", "bugs-barr"];
    if (proShots.includes(shot)) {
      try { proAccessActive = true; } catch (error) { /* older builds */ }
    }
    /* The Today screen opens with the three-step setup panel until a device has
       readings, a location and a catch in it. That is the right thing for a new
       install and for App Review, and the wrong thing for a store listing, where
       it would cover the screen a shot exists to show. Dismissing it is a stored
       preference set through the app's own key - state, not styling. Remove this
       and the captures are of a device that has never been set up. */
    try {
      localStorage.setItem("riseOnboarding.v1", "true");
      onboardingDismissed = true;
    } catch (error) { /* older builds */ }
    const setTab = (tab) => {
      if (typeof activateTab === "function") activateTab(tab);
    };
    const rerender = () => {
      if (typeof renderAll === "function") renderAll();
    };
    try {
      if (shot === "today-score") {
        scoreBreakdownOpen = true;
        if (typeof renderToday === "function") renderToday();
        setTab("today");
      } else if (shot === "waters") {
        expandedWaterId = null;
        if (typeof saveActiveWater === "function") saveActiveWater("lower-deschutes");
        rerender();
        setTab("waters");
      } else if (shot === "waters-detail") {
        if (typeof saveActiveWater === "function") saveActiveWater("lower-deschutes");
        expandedWaterId = "lower-deschutes";
        rerender();
        setTab("waters");
      } else if (shot === "trip") {
        if (typeof saveActiveWater === "function") saveActiveWater("lower-deschutes");
        rerender();
        setTab("trip");
      } else if (shot === "pack") {
        scoreBreakdownOpen = false;
        if (typeof renderToday === "function") renderToday();
        setTab("today");
        // Scrolled in the ready handler below, after activateTab's own scroll.
      } else if (shot === "bugs") {
        activeBug = "pmd";
        activeBugStage = null;
        activeFlyName = null;
        if (typeof renderBugs === "function") renderBugs();
        setTab("bugs");
      } else if (shot === "bugs-barr") {
        activeBug = "pmd";
        activeBugStage = "Emerger";
        activeFlyName = "Barr PMD Emerger #16";
        if (typeof renderBugs === "function") renderBugs();
        setTab("bugs");
      } else if (shot === "log") {
        /* The app no longer ships demo catches - a fresh install has an empty
           journal, which is the truth but a poor store listing. The Catch
           Journal shot is therefore captured over a seeded journal written to
           real storage and rendered by the real code path, provenance labels
           and all. Nothing here is styling: remove the seed and this is
           exactly what the screen looks like with three catches in it. */
        localStorage.setItem("riseLogs", JSON.stringify([
          { loggedAt: "2026-06-21T09:40:00", date: "Jun 21, 2026", time: "9:40 AM", waterName: "Lower Deschutes", waterId: "lower-deschutes", fly: "Elk Hair Caddis #14", fish: "Redband Trout", length: "17", count: "1", notes: "Soft inside seam below the riffle.", flow: "4,090 cfs", flowSource: "measured", temp: "54 F", tempSource: "measured", photo: "" },
          { loggedAt: "2026-06-18T18:50:00", date: "Jun 18, 2026", time: "6:50 PM", waterName: "Hosmer Lake", waterId: "hosmer", fly: "Callibaetis #14", fish: "Redband Trout", length: "19", count: "1", notes: "Cruising the channel edge.", flow: "Stillwater", flowSource: "reference", temp: "62 F", tempSource: "reference", photo: "" },
          { loggedAt: "2026-06-14T07:30:00", date: "Jun 14, 2026", time: "7:30 AM", waterName: "Crooked River", waterId: "crooked", fly: "Zebra Midge #18", fish: "Redband Trout", length: "14", count: "1", notes: "Ate on the first overcast push.", flow: "235 cfs", flowSource: "measured", temp: "51 F", tempSource: "measured", photo: "" }
        ]));
        localStorage.setItem("riseLogsSavedAt", "2026-06-21T09:40:00.000Z");
        logCache = null;
        logFormOpen = false;
        editingLogIndex = null;
        if (typeof renderLog === "function") renderLog();
        setTab("log");
      } else if (shot === "pro") {
        subscriptionPrices = fixturePrices;
        subscriptionLoading = false;
        subscriptionMessage = "Purchases are ready in the iOS app build.";
        billing = params.get("billing") === "monthly" ? "monthly" : "annual";
        if (typeof renderPro === "function") renderPro();
        setTab("pro");
      } else {
        scoreBreakdownOpen = false;
        if (typeof renderToday === "function") renderToday();
        setTab("today");
      }
      // Nothing to re-bind: handlers are delegated once from the document.
      // Chrome captures shortly after first paint, so anything that must appear
      // in the frame has to happen synchronously here rather than on a timer.
      // The app scrolls <main>, not the window: main is height:100% with
      // overflow-y:auto. Scrolling the window here did nothing.
      const scroller = document.querySelector("main");
      const applyScroll = () => {
        if (!scroller) return;
        if (shot === "pack") {
          const target = document.querySelector(".section-title");
          if (!target) throw new Error("pack shot: .section-title not found");
          scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
        } else {
          scroller.scrollTop = 0;
        }
      };
      applyScroll();
      if (shot === "pro") document.documentElement.dataset.screenshotOverflow = subscriptionOverflow();
      // Re-apply once late images have settled, then report the final position.
      setTimeout(() => {
        applyScroll();
        document.documentElement.dataset.screenshotScroll = String(Math.round(scroller ? scroller.scrollTop : 0));
        document.documentElement.dataset.screenshotReady = "true";
      }, 450);
    } catch (error) {
      document.body.insertAdjacentHTML("afterbegin", "<pre style='position:fixed;z-index:9999;background:white;color:red'>" + error.message + "</pre>");
      document.documentElement.dataset.screenshotReady = "error";
    }
  });
</script>`;

function ensureTools() {
  // resolveBinary already threw if either tool was missing.
  console.log(`Using browser: ${chrome}`);
  console.log(`Using ImageMagick: ${magick}`);
  if (workRoot !== resolve(root, "app-store-screenshots")) {
    console.log(`Using work directory: ${workRoot}`);
  }
}

const harnessAssetDirs = ["bug-plates", "fly-plates"];

function stageHarnessAssets() {
  for (const dir of harnessAssetDirs) {
    const source = resolve(root, dir);
    if (!existsSync(source)) throw new Error(`Missing asset directory: ${source}`);
    cpSync(source, resolve(tmpDir, dir), { recursive: true });
  }
}

function prepareHarness() {
  mkdirSync(tmpDir, { recursive: true });
  stageHarnessAssets();
  let html = readFileSync(sourceHtml, "utf8");
  // Base href points at the harness directory, which now holds the artwork, so
  // the document and every subresource live in one tree.
  html = html.replace("<head>", `<head>\n<base href="${pathToFileURL(`${tmpDir}/`).href}">`);
  html = html
    .replace("runInitialDataSync();", "/* screenshot harness: live data sync disabled */")
    .replace("startDailyOpenSyncWatcher();", "/* screenshot harness: sync watcher disabled */");
  html = html.replace("</head>", `${screenshotClock}\n${screenshotCss}\n</head>`);
  html = html.replace("</body>", `${screenshotJs}\n</body>`);
  writeFileSync(harnessPath, html);
}

function cleanOutputs() {
  [rawDir, iphoneDir, ipadDir, metadataDir].forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });
}

function runChromeScreenshot(device, shotId, shotKey, viewport) {
  const rawPath = resolve(rawDir, `${device}-${shotId}.png`);
  const url = `${pathToFileURL(harnessPath).href}?device=${device}&shot=${encodeURIComponent(shotKey)}`;
  try {
    execFileSync(chrome, [
      ...baseChromeFlags,
      `--user-data-dir=${resolve(tmpDir, `chrome-${device}-${shotId}`)}`,
      `--window-size=${viewport.width},${viewport.height}`,
      "--force-device-scale-factor=1",
      "--run-all-compositor-stages-before-draw",
      "--timeout=5000",
      `--screenshot=${rawPath}`,
      url
    ], { stdio: "ignore", timeout: chromeTimeoutMs });
  } catch (error) {
    if (!existsSync(rawPath)) throw error;
  }
  return rawPath;
}

function runSubscriptionScreenshot(plan, viewport) {
  const rawPath = resolve(rawDir, `metadata-${plan}.png`);
  const url = `${pathToFileURL(harnessPath).href}?device=iphone&shot=pro&billing=${plan}`;
  try {
    execFileSync(chrome, [
      ...baseChromeFlags,
      `--user-data-dir=${resolve(tmpDir, `chrome-metadata-${plan}`)}`,
      `--window-size=${viewport.width},${viewport.height}`,
      "--force-device-scale-factor=1",
      "--run-all-compositor-stages-before-draw",
      "--timeout=5000",
      `--screenshot=${rawPath}`,
      url
    ], { stdio: "ignore", timeout: chromeTimeoutMs });
  } catch (error) {
    if (!existsSync(rawPath)) throw error;
  }
  return rawPath;
}

function verifySubscriptionLayout(plan) {
  const viewport = { width: 500, height: 1082 };
  const url = `${pathToFileURL(harnessPath).href}?device=iphone&shot=pro&billing=${plan}`;
  let html = "";
  try {
    html = execFileSync(chrome, [
      ...baseChromeFlags,
      `--user-data-dir=${resolve(tmpDir, `chrome-layout-${plan}`)}`,
      `--window-size=${viewport.width},${viewport.height}`,
      "--force-device-scale-factor=1",
      "--dump-dom",
      url
    ], { encoding: "utf8", timeout: chromeTimeoutMs });
  } catch (error) {
    html = String(error.stdout || "");
    if (!html.includes("data-screenshot-overflow=")) throw error;
  }
  const overflow = html.match(/data-screenshot-overflow="([^"]+)"/)?.[1];
  if (overflow !== "none") {
    throw new Error(`Subscription screenshot layout failed for ${plan}: overflow=${overflow || "missing"}`);
  }
}

function resizeForStore(rawPath, outPath, size) {
  execFileSync(magick, [
    rawPath,
    "-resize",
    `${size.width}x${size.height}!`,
    "-strip",
    outPath
  ], { stdio: "ignore" });
}

function generateDevice(device, viewport, size, outDir) {
  for (const [shotId, shotKey] of shots) {
    const rawPath = runChromeScreenshot(device, shotId, shotKey, viewport);
    const outPath = resolve(outDir, `${shotId}.png`);
    resizeForStore(rawPath, outPath, size);
  }
}

function generateSubscriptionMetadata() {
  const viewport = { width: 500, height: 1082 };
  const size = { width: 1242, height: 2688 };
  for (const [plan, price] of [["monthly", "6.99"], ["annual", "49.99"]]) {
    const rawPath = runSubscriptionScreenshot(plan, viewport);
    const outPath = resolve(metadataDir, `iphone-${plan}-subscription-${price}.png`);
    resizeForStore(rawPath, outPath, size);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeSubscriptionManifest() {
  const outputs = [
    resolve(iphoneDir, "10-pro-upgrade.png"),
    resolve(ipadDir, "10-pro-upgrade.png"),
    resolve(metadataDir, "iphone-monthly-subscription-6.99.png"),
    resolve(metadataDir, "iphone-annual-subscription-49.99.png")
  ];
  const manifest = {
    version: 1,
    sourceSha256: sha256(sourceHtml),
    generatorSha256: sha256(generatorPath),
    outputs: Object.fromEntries(outputs.map((path) => [relative(root, path).replaceAll("\\", "/"), sha256(path)]))
  };
  writeFileSync(subscriptionManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

ensureTools();
prepareHarness();
cleanOutputs();
verifySubscriptionLayout("monthly");
verifySubscriptionLayout("annual");
generateDevice("iphone", { width: 500, height: 1082 }, { width: 1242, height: 2688 }, iphoneDir);
generateDevice("ipad", { width: 768, height: 1024 }, { width: 2064, height: 2752 }, ipadDir);
generateSubscriptionMetadata();
writeSubscriptionManifest();
console.log(`Created ${shots.length} iPhone screenshots in ${iphoneDir}`);
console.log(`Created ${shots.length} iPad screenshots in ${ipadDir}`);
console.log(`Created monthly and annual IAP review screenshots in ${metadataDir}`);
