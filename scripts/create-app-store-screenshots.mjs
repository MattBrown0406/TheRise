import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceHtml = resolve(root, "the-rise-app.html");
const tmpDir = resolve(root, "app-store-screenshots/tmp");
const rawDir = resolve(root, "app-store-screenshots/raw");
const iphoneDir = resolve(root, "app-store-screenshots/iphone");
const ipadDir = resolve(root, "app-store-screenshots/ipad");
const harnessPath = resolve(tmpDir, "the-rise-screenshot-harness.html");

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const magick = "/opt/homebrew/bin/magick";

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
  html.screenshot-mode main {
    height: 100vh !important;
    padding-bottom: 90px !important;
    overflow-y: auto !important;
  }
  html.screenshot-mode .footer-tabs {
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
  }
  html.screenshot-ipad main {
    padding-bottom: 104px !important;
  }
  html.screenshot-ipad .today-screen,
  html.screenshot-ipad .waters-screen,
  html.screenshot-ipad .trip-screen,
  html.screenshot-ipad .log-screen,
  html.screenshot-ipad .pro-layout,
  html.screenshot-ipad .bug-layout {
    max-width: 100% !important;
  }
  html.screenshot-ipad .app-shell {
    width: 100vw !important;
    max-width: 100vw !important;
  }
  html.screenshot-ipad .waters-screen .top-water-card,
  html.screenshot-ipad .waters-screen .ranked-water-card {
    grid-template-columns: minmax(0, 1fr) 116px !important;
  }
  html.screenshot-ipad .waters-screen .water-fly-preview {
    width: 116px !important;
    max-width: 116px !important;
  }
  html.screenshot-ipad .command-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }
  html.screenshot-ipad .condition-cards,
  html.screenshot-ipad .trip-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }
  html.screenshot-ipad .pack-box {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  }
  html.screenshot-ipad .bug-stage-strip,
  html.screenshot-ipad .stage-grid,
  html.screenshot-ipad .bench-stage-row {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  }
  html.screenshot-ipad .fly-library-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }
</style>`;

const screenshotJs = `
<script id="app-store-screenshot-js">
  document.documentElement.classList.add("screenshot-mode", "screenshot-" + (new URLSearchParams(location.search).get("device") || "iphone"));
  window.addEventListener("load", () => {
    const params = new URLSearchParams(location.search);
    const shot = params.get("shot") || "today";
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
        setTimeout(() => document.querySelector(".section-title")?.scrollIntoView({ block: "start" }), 120);
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
        logFormOpen = false;
        editingLogIndex = null;
        if (typeof renderLog === "function") renderLog();
        setTab("log");
      } else if (shot === "pro") {
        setTab("pro");
      } else {
        scoreBreakdownOpen = false;
        if (typeof renderToday === "function") renderToday();
        setTab("today");
      }
      if (typeof bindDynamic === "function") bindDynamic();
      setTimeout(() => {
        if (shot !== "pack") window.scrollTo(0, 0);
        document.documentElement.dataset.screenshotReady = "true";
      }, 450);
    } catch (error) {
      document.body.insertAdjacentHTML("afterbegin", "<pre style='position:fixed;z-index:9999;background:white;color:red'>" + error.message + "</pre>");
      document.documentElement.dataset.screenshotReady = "error";
    }
  });
</script>`;

function ensureTools() {
  if (!existsSync(chrome)) throw new Error(`Chrome not found at ${chrome}`);
  if (!existsSync(magick)) throw new Error(`ImageMagick not found at ${magick}`);
}

function prepareHarness() {
  mkdirSync(tmpDir, { recursive: true });
  let html = readFileSync(sourceHtml, "utf8");
  html = html.replace("<head>", `<head>\n<base href="${pathToFileURL(`${root}/`).href}">`);
  html = html
    .replace("runInitialDataSync();", "/* screenshot harness: live data sync disabled */")
    .replace("startDailyOpenSyncWatcher();", "/* screenshot harness: sync watcher disabled */");
  html = html.replace("</head>", `${screenshotCss}\n</head>`);
  html = html.replace("</body>", `${screenshotJs}\n</body>`);
  writeFileSync(harnessPath, html);
}

function cleanOutputs() {
  [rawDir, iphoneDir, ipadDir].forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });
}

function runChromeScreenshot(device, shotId, shotKey, viewport) {
  const rawPath = resolve(rawDir, `${device}-${shotId}.png`);
  const url = `${pathToFileURL(harnessPath).href}?device=${device}&shot=${encodeURIComponent(shotKey)}`;
  try {
    execFileSync(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-extensions",
      `--user-data-dir=${resolve(tmpDir, `chrome-${device}-${shotId}`)}`,
      `--window-size=${viewport.width},${viewport.height}`,
      "--force-device-scale-factor=1",
      "--run-all-compositor-stages-before-draw",
      "--timeout=5000",
      `--screenshot=${rawPath}`,
      url
    ], { stdio: "ignore", timeout: 10000 });
  } catch (error) {
    if (!existsSync(rawPath)) throw error;
  }
  return rawPath;
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

ensureTools();
prepareHarness();
cleanOutputs();
generateDevice("iphone", { width: 440, height: 956 }, { width: 1242, height: 2688 }, iphoneDir);
generateDevice("ipad", { width: 768, height: 1024 }, { width: 2064, height: 2752 }, ipadDir);
console.log(`Created ${shots.length} iPhone screenshots in ${iphoneDir}`);
console.log(`Created ${shots.length} iPad screenshots in ${ipadDir}`);
