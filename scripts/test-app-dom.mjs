#!/usr/bin/env node
/**
 * Real-DOM regression tests for the-rise-app.html.
 *
 * scripts/test-app-logic.mjs runs the app script against a stub DOM. That stub
 * has no event dispatch, no bubbling and no innerHTML parser, which is exactly
 * why a duplicated-listener bug and an unescaped-innerHTML bug both passed it
 * and shipped. These tests load the real file into real Chromium and click
 * real buttons.
 *
 * Run: node scripts/test-app-dom.mjs
 * Chrome is resolved at run time; override with RISE_CHROME.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Snap-packaged Chromium runs confined: it has a private /tmp, and its home
// interface does not cover dot-directories, so it can read neither /tmp nor a
// checkout living under a hidden path. The file under test is staged in a plain
// directory inside $HOME, which every browser build can open.
// Override with RISE_DOM_TEST_WORKDIR.
const workRoot = process.env.RISE_DOM_TEST_WORKDIR
  ? resolve(process.env.RISE_DOM_TEST_WORKDIR)
  : mkdtempSync(join(homedir(), "rise-dom-test-"));
// The override was honoured but never created, so the documented way to run
// this suite died with a bare ENOENT from copyFileSync instead of a message.
mkdirSync(workRoot, { recursive: true });
const stagedApp = resolve(workRoot, "the-rise-app.html");
copyFileSync(resolve(root, "the-rise-app.html"), stagedApp);
// The bug and fly artwork sits beside the HTML in the bundle, so it is staged
// beside the HTML here too. Without it the 404 check below cannot tell a
// genuinely missing asset from one the harness simply did not copy.
for (const plates of ["bug-plates", "fly-plates"]) {
  cpSync(resolve(root, plates), resolve(workRoot, plates), { recursive: true });
}
const appUrl = pathToFileURL(stagedApp).href;

/* A second copy with the CSS environment variables replaced by the insets a
   notched iPhone actually reports. env(safe-area-inset-*) cannot be emulated
   over the DevTools protocol, so substituting the device's own numbers is the
   only way to prove the padding lands on the right boxes rather than merely
   appearing somewhere in the stylesheet. */
const SAFE_AREA_TOP = 59;
const SAFE_AREA_BOTTOM = 34;
const insetApp = resolve(workRoot, "the-rise-app-insets.html");
writeFileSync(
  insetApp,
  readFileSync(resolve(root, "the-rise-app.html"), "utf8")
    .replaceAll("env(safe-area-inset-top)", `${SAFE_AREA_TOP}px`)
    .replaceAll("env(safe-area-inset-bottom)", `${SAFE_AREA_BOTTOM}px`)
);
const insetAppUrl = pathToFileURL(insetApp).href;

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  console.error("FAIL: puppeteer-core is not installed. Run: npm install");
  process.exit(1);
}

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

const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error(`FAIL: no Chrome or Chromium found. Tried:\n  ${chromeCandidates.join("\n  ")}\nSet RISE_CHROME to override.`);
  process.exit(1);
}

const runningAsRoot = process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0;

let failures = 0;
let checks = 0;

function assert(condition, label) {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

/* ------------------------------------------------------------------ */
/* Page setup                                                          */
/* ------------------------------------------------------------------ */

/**
 * Installs, before any app code runs:
 *  - a listener counter, so a duplicated handler is visible as a number
 *  - a scripted fetch, so no test touches the real USGS, NWS or ODFW
 *  - a request log, so the sync's network volume can be asserted on
 */
const instrumentation = `
  window.__listeners = [];
  const realAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, handler, options) {
    window.__listeners.push({ target: this, type });
    return realAdd.call(this, type, handler, options);
  };
  window.__listenerCount = function (target, type) {
    return window.__listeners.filter((entry) => entry.target === target && entry.type === type).length;
  };
  window.__elementListenerCount = function (selector, type) {
    const element = document.querySelector(selector);
    if (!element) return -1;
    return window.__listeners.filter((entry) => entry.target === element && entry.type === type).length;
  };

  window.__requests = [];
  window.__fetchPlan = { mode: "offline", body: "" };
  window.fetch = function (url) {
    const href = String(url);
    window.__requests.push(href);
    const plan = window.__fetchPlan;
    if (plan.mode === "offline") return Promise.reject(new TypeError("Failed to fetch"));
    if (href.startsWith("https://api.weather.gov/points/")) {
      return Promise.resolve(new Response(JSON.stringify({
        properties: { forecastHourly: "https://api.weather.gov/gridpoints/PDT/40,40/forecast/hourly" }
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (href.includes("api.weather.gov/gridpoints")) {
      return Promise.resolve(new Response(JSON.stringify({
        properties: { periods: [{ temperature: 71, windSpeed: "8 mph", windDirection: "W", shortForecast: "Sunny", startTime: "2026-06-21T18:00:00-07:00" }] }
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (href.includes("waterservices.usgs.gov")) {
      return Promise.resolve(new Response(JSON.stringify({ value: { timeSeries: [] } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (href.includes("myodfw.com")) {
      return Promise.resolve(new Response(plan.body, { status: 200, headers: { "Content-Type": "text/html" } }));
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  };
`;

/* Every page gets its own browser context.
   file:// pages share one localStorage origin, so tests used to inherit each
   other's journal and water cache. That made a fresh-install test impossible
   to write - which is exactly why the fresh-install path was never tested. */
const openContexts = [];

async function openApp(browser, { fetchPlan, viewport, url, before } = {}) {
  const context = await browser.createBrowserContext();
  openContexts.push(context);
  const page = await context.newPage();
  await page.setViewport(viewport || { width: 430, height: 932 });
  await page.evaluateOnNewDocument(instrumentation);
  if (before) await page.evaluateOnNewDocument(before);
  if (fetchPlan) {
    await page.evaluateOnNewDocument((plan) => {
      window.addEventListener("DOMContentLoaded", () => {});
      Object.defineProperty(window, "__pendingFetchPlan", { value: plan, writable: true });
    }, fetchPlan);
  }
  await page.goto(url || appUrl, { waitUntil: "load" });
  if (fetchPlan) await page.evaluate(() => { window.__fetchPlan = window.__pendingFetchPlan; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));
  return page;
}

async function seedLogs(page, entries) {
  await page.evaluate((seed) => {
    localStorage.setItem("riseLogs", JSON.stringify(seed));
    window.__reload = true;
  }, entries);
  await page.reload({ waitUntil: "load" });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));
}

function sampleEntryFor(index) {
  return sampleEntry({
    loggedAt: new Date(Date.UTC(2026, 5, 1, 12, 0, index)).toISOString(),
    fly: `Seed Fly #${index}`,
    notes: `entry ${index}`
  });
}

function sampleEntry(overrides = {}) {
  return {
    loggedAt: "2026-06-21T18:00:00.000Z",
    date: "Jun 21, 2026",
    time: "6:00 PM",
    waterName: "Crooked River",
    waterId: "crooked",
    fly: "Zebra Midge #18",
    fish: "Redband Trout",
    length: "14",
    count: "1",
    notes: "",
    flow: "235 cfs",
    temp: "53 F",
    photoId: "",
    photo: "",
    ...overrides
  };
}

/* ------------------------------------------------------------------ */

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: runningAsRoot ? ["--no-sandbox", "--disable-dev-shm-usage"] : ["--disable-dev-shm-usage"]
});

try {
  /* ---------------------------------------------------------------- */
  group("Handlers are delegated once, not re-attached per render (#1)");

  {
    const page = await openApp(browser);
    await seedLogs(page, ["A", "B", "C", "D", "E"].map((tag, index) =>
      sampleEntry({ notes: tag, loggedAt: `2026-06-2${index + 1}T18:00:00.000Z` })));

    await page.evaluate(() => activateTab("log"));

    const before = await page.evaluate(() => window.__listenerCount(document, "click"));
    await page.evaluate(() => {
      for (let index = 0; index < 20; index += 1) renderAll();
    });
    const after = await page.evaluate(() => window.__listenerCount(document, "click"));
    assert(before === after, `20 repaints add no click listeners (${before} before, ${after} after)`);
    assert(after <= 2, `the document carries a single delegated click listener (${after})`);

    const deleteListeners = await page.evaluate(() => window.__elementListenerCount("[data-delete-log]", "click"));
    assert(deleteListeners === 0, `Delete buttons carry no per-element listener (${deleteListeners})`);

    const deleted = await page.evaluate(async () => {
      const beforeCount = getLogs().length;
      document.querySelector("[data-delete-log]").click();
      await new Promise((done) => requestAnimationFrame(done));
      return { beforeCount, afterCount: getLogs().length, remaining: getLogs().map((entry) => entry.notes) };
    });
    assert(deleted.beforeCount === 5, "five entries before the delete");
    assert(deleted.afterCount === 4, `one Delete tap removes exactly one catch (${deleted.beforeCount} to ${deleted.afterCount})`);
    assert(
      JSON.stringify(deleted.remaining) === JSON.stringify(["B", "C", "D", "E"]),
      `the other four are untouched (${deleted.remaining.join(",")})`
    );
    await page.close();
  }

  {
    const page = await openApp(browser);
    await seedLogs(page, []);
    await page.evaluate(() => {
      activateTab("log");
      for (let index = 0; index < 10; index += 1) renderAll();
    });
    const saved = await page.evaluate(async () => {
      document.querySelector("[data-new-log]").click();
      await new Promise((done) => requestAnimationFrame(done));
      const form = document.querySelector("#logForm");
      form.querySelector("[name=fly]").value = "Elk Hair Caddis #16";
      form.querySelector("button[type=submit]").click();
      await new Promise((done) => setTimeout(done, 150));
      return getLogs().map((entry) => entry.fly);
    });
    assert(saved.length === 1, `one Save tap writes exactly one entry (wrote ${saved.length})`);
    assert(saved[0] === "Elk Hair Caddis #16", "the saved entry holds the typed fly");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Catch-log text is escaped before it reaches innerHTML (#3)");

  {
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({
      fly: 'PMD "Sparkle" Dun #16',
      notes: '<img src=x onerror="window.__xss=1"> good day & tight lines'
    })]);
    const result = await page.evaluate(async () => {
      activateTab("log");
      await new Promise((done) => setTimeout(done, 120));
      const card = document.querySelector(".catch-card");
      document.querySelector("[data-edit-log]").click();
      await new Promise((done) => requestAnimationFrame(done));
      return {
        xss: window.__xss,
        injectedImage: Boolean(document.querySelector('.catch-card img[src="x"]')),
        cardText: card ? card.textContent : "",
        flyField: document.querySelector("#logForm [name=fly]").value,
        notesField: document.querySelector("#logForm [name=notes]").value
      };
    });
    assert(result.xss === undefined, "script in a note does not execute");
    assert(result.injectedImage === false, "markup in a note is not parsed into elements");
    assert(result.cardText.includes("good day & tight lines"), "the whole note is displayed, not truncated at the first '<'");
    assert(result.cardText.includes('PMD "Sparkle" Dun #16'), "a fly name containing quotes displays in full");
    assert(result.flyField === 'PMD "Sparkle" Dun #16', `the edit form round-trips the quoted fly name (got: ${result.flyField})`);
    assert(result.notesField.includes("good day & tight lines"), "the edit form round-trips the note");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("An unreadable source contributes nothing and is named nowhere (#2)");

  {
    const page = await openApp(browser, { fetchPlan: { mode: "offline", body: "" } });
    const intel = await page.evaluate(async () => {
      window.__requests.length = 0;
      const result = await scrubLocalResources("manual");
      return {
        waters: Object.keys(result.byWater).length,
        errors: result.errors.length,
        requested: window.__requests.slice()
      };
    });
    assert(intel.waters === 0, `no water is given local intel when every fetch fails (${intel.waters})`);
    assert(intel.errors > 0, "the failures are recorded as errors");
    assert(
      !intel.requested.some((url) => /confluenceflyshop|flyfishersplace|deschutescamp|deschutesriveralliance/.test(url)),
      "no commercial fly shop, guide or conservation page is fetched (#6)"
    );
    await page.close();
  }

  {
    // A page that reports on the Metolius must not hand its hatches to the Crooked.
    const body = `<html><body>
      <nav>Shop clearance goods</nav>
      <p>Metolius River: green drakes are on and fishing well in the mornings.</p>
      <p>Crooked River: flows are up, the water is off color and fishing has been slow.</p>
    </body></html>`;
    const page = await openApp(browser, { fetchPlan: { mode: "online", body } });
    const intel = await page.evaluate(async () => {
      const result = await scrubLocalResources("manual");
      return result.byWater;
    });
    const metolius = intel.metolius || { hatches: [], cues: [], scoreBoost: 0 };
    const crooked = intel.crooked || { hatches: [], cues: [], scoreBoost: 0 };
    assert(metolius.hatches.includes("Green Drake"), `the Metolius gets the green drake (${metolius.hatches.join(",")})`);
    assert(!crooked.hatches.includes("Green Drake"), `the Crooked does not (${crooked.hatches.join(",")})`);
    assert(metolius.scoreBoost > 0, `a positive read raises the Metolius (${metolius.scoreBoost})`);
    assert(crooked.scoreBoost < 0, `a slow read lowers the Crooked (${crooked.scoreBoost})`);
    assert(
      !metolius.cues.includes("positive human report") || !crooked.cues.includes("positive human report"),
      "the navigation's 'goods' and 'clearance' do not read as a positive report for every water"
    );
    assert(
      !crooked.cues.includes("clear water"),
      "'clearance' in the page chrome is not read as clear water"
    );
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A daily open does not flood api.weather.gov (#5)");

  {
    const page = await openApp(browser, { fetchPlan: { mode: "online", body: "<p>ODFW Central Zone report.</p>" } });
    const traffic = await page.evaluate(async () => {
      window.__requests.length = 0;
      await refreshAllWaterReports("daily-open");
      const requests = window.__requests.slice();
      return {
        total: requests.length,
        weather: requests.filter((url) => url.includes("api.weather.gov")).length,
        points: requests.filter((url) => url.includes("api.weather.gov/points/")).length,
        uniquePoints: new Set(requests.filter((url) => url.includes("api.weather.gov/points/"))).size
      };
    });
    assert(traffic.weather <= 24, `a daily open makes at most 24 weather requests (made ${traffic.weather})`);
    assert(traffic.total <= 40, `a daily open makes at most 40 requests in total (made ${traffic.total})`);
    assert(
      traffic.points === traffic.uniquePoints,
      `no coordinate is looked up twice (${traffic.points} point requests, ${traffic.uniquePoints} distinct)`
    );

    // The grid a coordinate resolves to is a constant, so a second sync must
    // not ask for it again.
    const second = await page.evaluate(async () => {
      window.__requests.length = 0;
      liveReports.bulkStatus = "";
      await refreshAllWaterReports("manual");
      return window.__requests.filter((url) => url.includes("api.weather.gov/points/")).length;
    });
    assert(second === 0, `a second sync makes no /points requests at all (made ${second})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Nothing on screen calls the app a prototype or a demo (#4)");

  {
    const page = await openApp(browser);
    const language = await page.evaluate(async () => {
      const screens = ["today", "waters", "trip", "bugs", "log", "pro"];
      const found = [];
      for (const id of screens) {
        activateTab(id);
        await new Promise((done) => requestAnimationFrame(done));
        const text = document.querySelector(`#${id}`).textContent;
        if (/\b(prototype|demo)\b/i.test(text)) found.push(id);
      }
      return { found, title: document.title };
    });
    assert(language.found.length === 0, `no screen uses prototype or demo language (${language.found.join(",") || "none"})`);
    assert(!/prototype|demo/i.test(language.title), `the window title is shippable ("${language.title}")`);
    await page.close();
  }
  /* ---------------------------------------------------------------- */
  group("Every registered action still fires");

  {
    // Delegation moved 35 handlers at once. This clicks one live element for
    // each registered selector and fails on the first uncaught page error,
    // which is what a mistyped selector or a renamed handler looks like.
    const page = await openApp(browser);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const outcome = await page.evaluate(async () => {
      const wait = () => new Promise((done) => setTimeout(done, 60));
      const screens = ["today", "waters", "trip", "bugs", "log", "pro"];
      const selectors = clickActions.map(([selector]) => selector);
      const fired = new Set();
      const missing = [];
      for (const screen of screens) {
        activateTab(screen);
        await wait();
        for (const selector of selectors) {
          if (fired.has(selector)) continue;
          const element = document.querySelector(`#${screen} ${selector}`);
          if (!element) continue;
          element.click();
          await wait();
          fired.add(selector);
          activateTab(screen);
          await wait();
        }
      }
      for (const selector of selectors) {
        if (!fired.has(selector)) missing.push(selector);
      }
      return { fired: fired.size, total: selectors.length, missing };
    });

    assert(pageErrors.length === 0, `clicking every reachable action throws nothing (${pageErrors.join(" | ") || "no errors"})`);
    assert(outcome.fired >= 20, `at least 20 of the ${outcome.total} registered actions were reachable and fired (${outcome.fired})`);
    console.log(`  note not reachable from a cold start: ${outcome.missing.join(", ") || "none"}`);
    await page.close();
  }
  /* ---------------------------------------------------------------- */
  group("The shell fills the device on iPad, with no simulated phone (#1 round three)");

  {
    const devices = [
      { label: "iPad portrait", width: 810, height: 1080 },
      { label: "iPad landscape", width: 1180, height: 820 },
      { label: "iPad mini portrait", width: 744, height: 1133 }
    ];
    for (const device of devices) {
      const page = await openApp(browser, { viewport: { width: device.width, height: device.height } });
      const shell = await page.evaluate(() => {
        const element = document.querySelector(".app-shell");
        const style = getComputedStyle(element);
        return {
          width: Math.round(element.getBoundingClientRect().width),
          radius: style.borderTopLeftRadius,
          shadow: style.boxShadow,
          commandColumns: getComputedStyle(document.querySelector(".command-grid") || element).gridTemplateColumns
        };
      });
      assert(shell.width >= device.width - 1, `${device.label}: the shell fills the viewport (${shell.width} of ${device.width})`);
      assert(shell.radius === "0px", `${device.label}: no simulated device corner radius (${shell.radius})`);
      assert(shell.shadow === "none", `${device.label}: no simulated bezel ring (${shell.shadow})`);
      assert(shell.commandColumns.split(" ").length === 3, `${device.label}: the command grid is three-up (${shell.commandColumns.split(" ").length} columns)`);
      await page.close();
    }

    const phone = await openApp(browser);
    const phoneShell = await phone.evaluate(() => ({
      width: Math.round(document.querySelector(".app-shell").getBoundingClientRect().width),
      commandColumns: getComputedStyle(document.querySelector(".command-grid")).gridTemplateColumns.split(" ").length
    }));
    assert(phoneShell.width === 430, `iPhone: the shell still fills the viewport (${phoneShell.width})`);
    assert(phoneShell.commandColumns === 2, `iPhone: the command grid stays two-up (${phoneShell.commandColumns})`);
    await phone.close();
  }

  /* ---------------------------------------------------------------- */
  group("A fresh install has no fishing history (#2 round three)");

  {
    const page = await openApp(browser);
    const fresh = await page.evaluate(() => {
      activateTab("log");
      return {
        stats: [...document.querySelectorAll("#log .log-stat strong")].map((node) => node.textContent.trim()),
        realCards: document.querySelectorAll("#log .catch-card:not(.example-card)").length,
        exampleCards: document.querySelectorAll("#log .example-card").length,
        exampleControls: document.querySelectorAll("#log .example-card [data-edit-log], #log .example-card [data-delete-log]").length,
        labelled: Boolean(document.querySelector("#log [data-example-logs-label]")),
        logs: getLogs().length,
        stored: localStorage.getItem("riseLogs"),
        memory: personalMemoryFor(waters.find((water) => water.id === "lower-deschutes")).lines.join(" | ")
      };
    });
    assert(fresh.stats[0] === "0", `the fish count starts at zero (${fresh.stats[0]})`);
    assert(fresh.stats[1] === "0", `the trip count starts at zero (${fresh.stats[1]})`);
    assert(fresh.stats[2] === "-", `there is no top fly yet (${fresh.stats[2]})`);
    assert(fresh.realCards === 1, `only the empty-state card is shown as a journal entry (${fresh.realCards})`);
    assert(fresh.exampleCards === 3, `the three illustrations are marked as examples (${fresh.exampleCards})`);
    assert(fresh.exampleControls === 0, `examples carry no edit or delete controls (${fresh.exampleControls})`);
    assert(fresh.labelled, "the examples are labelled as not the user's catches");
    assert(fresh.logs === 0, `getLogs() returns an empty journal (${fresh.logs})`);
    assert(fresh.stored === null, "nothing has been written to storage");
    assert(!/Elk Hair Caddis/.test(fresh.memory), `local memory claims no history (${fresh.memory})`);

    // The path that used to make the demo permanent: one real save.
    const afterSave = await page.evaluate(async () => {
      document.querySelector("[data-new-log]").click();
      await new Promise((done) => setTimeout(done, 60));
      document.querySelector("#logForm [name=fly]").value = "MY REAL FLY";
      document.querySelector("#logForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 200));
      const stored = JSON.parse(localStorage.getItem("riseLogs") || "[]");
      return { count: stored.length, flies: stored.map((entry) => entry.fly) };
    });
    assert(afterSave.count === 1, `saving one catch stores exactly one catch (${afterSave.count})`);
    assert(afterSave.flies.join(",") === "MY REAL FLY", `no example entry was persisted alongside it (${afterSave.flies.join(",")})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A launch where every request failed reports failure (#3 round three)");

  {
    const page = await openApp(browser, { fetchPlan: { mode: "offline", body: "" } });
    await page.evaluate(async () => {
      await refreshAllWaterReports("daily-open");
    });
    const outcome = await page.evaluate(() => {
      const report = liveReports.byWater[activeWater];
      return {
        status: report?.status,
        cached: cachedWaterCount(),
        cacheKey: liveReports.cache?.lastDailyOpen || "",
        freshness: dataFreshnessLabel(),
        scoreLabel: scoreSourceLabel(getWater()),
        willRetry: shouldRunDailyOpenSync()
      };
    });
    assert(outcome.status === "error", `a report with no payload is not "ready" (${outcome.status})`);
    assert(outcome.cached === 0, `nothing was written to the offline cache (${outcome.cached})`);
    assert(!/Offline-ready/.test(outcome.freshness), `the app does not claim to be offline-ready (${outcome.freshness})`);
    assert(!/Live-adjusted/.test(outcome.scoreLabel), `the score is not described as live (${outcome.scoreLabel})`);
    assert(outcome.cacheKey === "", "the day was not marked as synced");
    assert(outcome.willRetry === true, "the app will try again when signal returns");

    // Signal comes back: the same day must still sync.
    const recovered = await page.evaluate(async () => {
      window.__fetchPlan = { mode: "online", body: "<html><body>Deschutes River is fishing well.</body></html>" };
      await refreshAllWaterReports("daily-open");
      return { cached: cachedWaterCount(), marked: Boolean(liveReports.cache?.lastDailyOpen) };
    });
    assert(recovered.cached > 0, `a later sync on the same day still runs and caches (${recovered.cached} waters)`);
    assert(recovered.marked, "a sync that actually fetched marks the day complete");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Switching tabs returns to the top of the screen (#6 round three)");

  {
    const page = await openApp(browser);
    const scroll = await page.evaluate(async () => {
      const main = document.querySelector("main");
      activateTab("waters");
      await new Promise((done) => setTimeout(done, 60));
      main.scrollTop = main.scrollHeight;
      await new Promise((done) => setTimeout(done, 60));
      const scrolled = main.scrollTop;
      activateTab("bugs");
      await new Promise((done) => setTimeout(done, 500));
      return { scrolled, after: main.scrollTop };
    });
    assert(scroll.scrolled > 200, `the Waters screen scrolls (${scroll.scrolled})`);
    assert(scroll.after === 0, `switching to Bugs lands at the top (${scroll.after})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("The container backup never overwrites a live journal (#7 round three)");

  {
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ notes: "KEEP-ME", loggedAt: "2026-07-01T18:00:00.000Z" })]);
    const stale = await page.evaluate(() => {
      const older = JSON.stringify({
        version: 2,
        savedAt: "2020-01-01T00:00:00.000Z",
        logs: [
          { loggedAt: "2019-01-01T00:00:00.000Z", notes: "DELETED-1", fly: "x", fish: "y", waterName: "z" },
          { loggedAt: "2019-01-02T00:00:00.000Z", notes: "DELETED-2", fly: "x", fish: "y", waterName: "z" }
        ]
      });
      window.riseLogRestore({ body: older });
      return getLogs().map((entry) => entry.notes);
    });
    assert(stale.join(",") === "KEEP-ME", `a longer stale backup does not replace the journal (${stale.join(",")})`);

    const purged = await page.evaluate(() => {
      localStorage.removeItem("riseLogs");
      localStorage.removeItem("riseLogsSavedAt");
      logCache = null;
      window.riseLogRestore({ body: JSON.stringify({
        version: 2,
        savedAt: "2026-08-01T00:00:00.000Z",
        logs: [{ loggedAt: "2026-07-01T18:00:00.000Z", notes: "KEEP-ME", fly: "x", fish: "y", waterName: "z" }]
      }) });
      return getLogs().map((entry) => entry.notes);
    });
    assert(purged.join(",") === "KEEP-ME", `a purged journal is restored from the backup (${purged.join(",")})`);

    const legacy = await page.evaluate(() => {
      localStorage.removeItem("riseLogs");
      localStorage.removeItem("riseLogsSavedAt");
      logCache = null;
      window.riseLogRestore({ body: JSON.stringify([{ loggedAt: "2026-06-01T00:00:00.000Z", notes: "OLD-BUILD", fly: "x", fish: "y", waterName: "z" }]) });
      return getLogs().map((entry) => entry.notes);
    });
    assert(legacy.join(",") === "OLD-BUILD", `a bare array from an older build still restores (${legacy.join(",")})`);

    const editing = await page.evaluate(() => {
      localStorage.setItem("riseLogs", JSON.stringify([
        { loggedAt: "2026-07-01T00:00:00.000Z", notes: "FLY-A", fly: "a", fish: "y", waterName: "z" },
        { loggedAt: "2026-07-02T00:00:00.000Z", notes: "FLY-B", fly: "b", fish: "y", waterName: "z" },
        { loggedAt: "2026-07-03T00:00:00.000Z", notes: "FLY-C", fly: "c", fish: "y", waterName: "z" }
      ]));
      localStorage.setItem("riseLogsSavedAt", "2026-07-03T00:00:00.000Z");
      logCache = null;
      activateTab("log");
      renderLog();
      document.querySelector("[data-edit-log='2']").click();
      const before = getLogs()[editingLogIndex]?.notes;
      window.riseLogRestore({ body: JSON.stringify({
        version: 2,
        savedAt: "2026-09-01T00:00:00.000Z",
        logs: [
          { loggedAt: "2026-07-03T00:00:00.000Z", notes: "FLY-C", fly: "c", fish: "y", waterName: "z" },
          { loggedAt: "2026-07-02T00:00:00.000Z", notes: "FLY-B", fly: "b", fish: "y", waterName: "z" },
          { loggedAt: "2026-07-01T00:00:00.000Z", notes: "FLY-A", fly: "a", fish: "y", waterName: "z" }
        ]
      }) });
      return { before, after: editingLogIndex === null ? null : getLogs()[editingLogIndex]?.notes };
    });
    assert(editing.before === "FLY-C", `the edit form opened on FLY-C (${editing.before})`);
    assert(editing.after === "FLY-C", `a restore that reorders the journal keeps the form on the same catch (${editing.after})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A logged reading carries where it came from (#8 round three)");

  {
    const page = await openApp(browser);
    await seedLogs(page, [
      sampleEntry({ notes: "measured", flow: "235 cfs", flowSource: "measured", temp: "53 F", tempSource: "measured", loggedAt: "2026-07-03T00:00:00.000Z" }),
      sampleEntry({ notes: "reference", flow: "4,160 cfs", flowSource: "reference", temp: "54 F", tempSource: "reference", loggedAt: "2026-07-02T00:00:00.000Z" }),
      sampleEntry({ notes: "legacy", flow: "1,020 cfs", temp: "51 F", loggedAt: "2026-07-01T00:00:00.000Z" })
    ]);
    const shown = await page.evaluate(() => {
      activateTab("log");
      return {
        cards: [...document.querySelectorAll("#log .catch-card .catch-conditions")].map((node) => node.textContent.trim()),
        csv: logCsv()
      };
    });
    assert(/235 cfs \(measured\)/.test(shown.cards[0]), `a gauge reading is shown as measured (${shown.cards[0]})`);
    assert(/4,160 cfs \(reference\)/.test(shown.cards[1]), `a seasonal value is shown as reference (${shown.cards[1]})`);
    assert(/source unknown/.test(shown.cards[2]), `an entry from an older build says so (${shown.cards[2]})`);
    assert(/"Flow source"/.test(shown.csv) && /"Water temp source"/.test(shown.csv), "the CSV carries both source columns");
    assert(/"4,160 cfs","reference"/.test(shown.csv), "the CSV pairs each reading with its source");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("The water search keeps the caret where the angler put it (#9 round three)");

  {
    const page = await openApp(browser);
    // Real keystrokes. Assigning .value in script moves the caret to the end
    // by itself, which would have made this test pass against the bug.
    await page.evaluate(async () => {
      activateTab("waters");
      await new Promise((done) => setTimeout(done, 60));
      document.querySelector("[data-water-search]").focus();
    });
    await page.keyboard.type("deschutes", { delay: 10 });
    await page.evaluate(() => {
      const field = document.querySelector("[data-water-search]");
      field.focus();
      field.setSelectionRange(3, 3);
    });
    await page.keyboard.type("X", { delay: 10 });
    const caret = await page.evaluate(() => {
      const field = document.querySelector("[data-water-search]");
      return { value: field.value, start: field.selectionStart, end: field.selectionEnd };
    });
    assert(caret.value === "desXchutes", `the character lands where the caret was (${caret.value})`);
    assert(caret.start === 4 && caret.end === 4, `the caret stays mid-word, ready for the next character (${caret.start},${caret.end})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("An edit does not rewrite the conditions the fish was caught in (#2 round four)");

  {
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({
      waterId: "lower-deschutes",
      waterName: "Lower Deschutes",
      loggedAt: "2026-04-02T18:00:00.000Z",
      date: "Apr 2, 2026",
      flow: "1,120 cfs",
      flowSource: "measured",
      temp: "48 F",
      tempSource: "measured",
      notes: "original note"
    })]);
    const edited = await page.evaluate(async () => {
      activateTab("log");
      await new Promise((done) => requestAnimationFrame(done));
      document.querySelector("[data-edit-log]").click();
      await new Promise((done) => setTimeout(done, 60));
      document.querySelector("#logForm [name=notes]").value = "corrected note";
      document.querySelector("#logForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 250));
      const stored = JSON.parse(localStorage.getItem("riseLogs") || "[]");
      return { entry: stored[0], count: stored.length, card: document.querySelector(".catch-card")?.textContent || "" };
    });
    assert(edited.count === 1, `editing does not add an entry (${edited.count})`);
    assert(edited.entry.notes === "corrected note", "the edit the angler made is saved");
    assert(edited.entry.flow === "1,120 cfs", `the recorded flow survives the edit (${edited.entry.flow})`);
    assert(edited.entry.temp === "48 F", `the recorded water temperature survives it (${edited.entry.temp})`);
    assert(edited.entry.flowSource === "measured", "and it is still a measurement, not today's reference value");
    assert(edited.entry.date === "Apr 2, 2026", `the catch is still dated April (${edited.entry.date})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("One double-tap on Save writes one catch (#5 round four)");

  {
    const page = await openApp(browser);
    const saved = await page.evaluate(async () => {
      activateTab("log");
      await new Promise((done) => requestAnimationFrame(done));
      document.querySelector("[data-new-log]").click();
      await new Promise((done) => setTimeout(done, 60));
      const form = document.querySelector("#logForm");
      form.querySelector("[name=fly]").value = "X-Caddis #16";
      // Two taps inside the await, which is what a real double-tap is.
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 300));
      const stored = JSON.parse(localStorage.getItem("riseLogs") || "[]");
      return { count: stored.length, flies: stored.map((entry) => entry.fly) };
    });
    assert(saved.count === 1, `two taps write one catch (${saved.count}: ${saved.flies.join(", ")})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("The water search field is escaped and keeps the keyboard (#4, #7, #8 round four)");

  {
    const page = await openApp(browser);
    const injection = await page.evaluate(async () => {
      activateTab("waters");
      await new Promise((done) => requestAnimationFrame(done));
      const field = document.querySelector("[data-water-search]");
      const before = field;
      field.focus();
      field.value = 'a" onfocus="window.__xss=1" x="';
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((done) => setTimeout(done, 200));
      const after = document.querySelector("[data-water-search]");
      after.blur();
      after.focus();
      await new Promise((done) => setTimeout(done, 60));
      return {
        value: after.value,
        sameNode: before === after,
        focused: document.activeElement === after,
        xss: window.__xss,
        outerHtml: after.outerHTML,
        topCards: document.querySelectorAll("#waters .top-water-card").length,
        headline: document.querySelector("#waters h1")?.textContent || "",
        listHead: document.querySelector("#waters .waters-list-head")?.textContent || ""
      };
    });
    assert(injection.xss === undefined, "an injected onfocus handler does not run");
    assert(!/onfocus/.test(injection.outerHtml), "and it never becomes an attribute");
    assert(injection.value === 'a" onfocus="window.__xss=1" x="',
      `a search term containing a quote is not truncated (${injection.value})`);
    assert(injection.sameNode, "the field the angler is typing in is never replaced");
    assert(injection.focused, "so focus - and the iOS keyboard - stays put");
    assert(injection.topCards === 0, "a search with no matches shows no top water card");
    assert(/no match/i.test(injection.headline), `the headline says there are no matches (${injection.headline})`);
    assert(/^0 waters/.test(injection.listHead.trim()), `and the count agrees (${injection.listHead.trim()})`);
    await page.close();
  }

  {
    const page = await openApp(browser);
    const typing = await page.evaluate(async () => {
      activateTab("waters");
      await new Promise((done) => requestAnimationFrame(done));
      const field = document.querySelector("[data-water-search]");
      const identity = field;
      field.focus();
      const before = window.__listeners.length;
      for (const character of "deschutes") {
        field.value += character;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await new Promise((done) => setTimeout(done, 250));
      return {
        sameNode: document.querySelector("[data-water-search]") === identity,
        newListeners: window.__listeners.length - before,
        matches: document.querySelectorAll("#waters .ranked-water-card").length,
        headline: document.querySelector("#waters h1")?.textContent || "",
        toolbarButtons: document.querySelectorAll("#waters [data-water-filter]").length
      };
    });
    assert(typing.sameNode, "nine keystrokes leave the search field in place");
    assert(typing.newListeners === 0, `and attach no new listeners (${typing.newListeners})`);
    assert(/deschutes/i.test(typing.headline), `the results still follow the query (${typing.headline})`);
    assert(typing.toolbarButtons === 3, "the toolbar is not rebuilt around the field");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A hidden water is not offered as a home water (round four, smaller)");

  {
    const page = await openApp(browser);
    const options = await page.evaluate(async () => {
      const hidden = waters.find((water) => water.id !== homeWaterId);
      localStorage.setItem("riseHiddenWaters.v1", JSON.stringify([hidden.id]));
      location.reload();
      return hidden.id;
    }).catch(() => null);
    await page.waitForNavigation({ waitUntil: "load" }).catch(() => {});
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    const listed = await page.evaluate((hiddenId) => {
      activateTab("today");
      const values = [...document.querySelectorAll("#home-water-select option")].map((option) => option.value);
      return { values, hiddenId, hiddenCount: hiddenWaterIds.length, selected: homeWaterId };
    }, options);
    assert(listed.hiddenCount === 1, `the water is hidden (${listed.hiddenCount})`);
    assert(!listed.values.includes(listed.hiddenId), "a hidden water is not offered in the home-water list");
    assert(listed.values.includes(listed.selected), "the selected home water is still listed");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("The Pro card fits an iPhone in every price state (#1 round five)");

  for (const width of [390, 430]) {
    const page = await openApp(browser, { viewport: { width, height: 844 } });
    const states = await page.evaluate(async () => {
      const measure = () => {
        renderPro();
        activateTab("pro");
        const hero = document.querySelector("#pro .pro-hero");
        const screen = document.querySelector("#pro");
        return {
          heroOverflow: hero.scrollWidth - hero.clientWidth,
          screenOverflow: screen.scrollWidth - screen.clientWidth,
          documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
          priceText: document.querySelector("#pro .price strong")?.textContent || "",
          restoreVisible: Boolean(document.querySelector("#pro [data-restore-purchases]")?.getBoundingClientRect().width)
        };
      };
      const out = {};
      subscriptionLoading = true;
      subscriptionPrices = { monthly: null, annual: null };
      out.loading = measure();
      subscriptionLoading = false;
      out.unavailable = measure();
      subscriptionPrices = { monthly: "$6.99", annual: "$49.99" };
      out.priced = measure();
      return out;
    });
    for (const [state, result] of Object.entries(states)) {
      assert(result.heroOverflow <= 0,
        `${width}pt / ${state} ("${result.priceText}"): the hero card does not overflow (${result.heroOverflow}px)`);
      assert(result.documentOverflow <= 0,
        `${width}pt / ${state}: nothing runs off the right edge of the screen (${result.documentOverflow}px)`);
      assert(result.restoreVisible, `${width}pt / ${state}: Restore Purchases is still on screen`);
    }
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Searching the water list does not retarget the chosen water (#2 round five)");

  {
    const page = await openApp(browser);
    const result = await page.evaluate(async () => {
      activateTab("waters");
      await new Promise((done) => requestAnimationFrame(done));
      const target = waters.find((water) => water.id === "lower-deschutes") || waters[1];
      const card = document.querySelector(`.waters-main-list [data-water="${target.id}"]`)
        || (() => { saveActiveWater(target.id); return null; })();
      if (card) card.click();
      const chosen = activeWater;
      const field = document.querySelector("[data-water-search]");
      field.value = "todd";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((done) => setTimeout(done, 250));
      const duringSearch = activeWater;
      const searchResults = [...document.querySelectorAll(".waters-main-list [data-water]")].map((node) => node.dataset.water);
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((done) => setTimeout(done, 250));
      renderTrip();
      const tripWater = document.querySelector("#trip h1")?.textContent || "";
      return { chosen, duringSearch, afterClear: activeWater, searchResults, tripWater, targetName: target.name };
    });
    assert(result.chosen === "lower-deschutes", `the angler picked the Lower Deschutes (${result.chosen})`);
    assert(result.searchResults.length && !result.searchResults.includes("lower-deschutes"),
      `the search excludes it from the list (${result.searchResults.slice(0, 3).join(", ")})`);
    assert(result.duringSearch === result.chosen,
      `searching for another water does not change the selection (${result.duringSearch})`);
    assert(result.afterClear === result.chosen,
      `and clearing the search leaves it where it was (${result.afterClear})`);
    assert(result.tripWater.includes(result.targetName),
      `the trip screen and the selection agree (${result.tripWater})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A failed write leaves the journal alone on screen (#4 round five)");

  {
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ fly: "ORIGINAL FLY", notes: "as caught" })]);
    const result = await page.evaluate(async () => {
      activateTab("log");
      await new Promise((done) => requestAnimationFrame(done));
      document.querySelector("[data-edit-log]")?.click();
      await new Promise((done) => requestAnimationFrame(done));
      const form = document.querySelector("#logForm form") || document.querySelector("#logForm");
      const flyField = form.querySelector("[name=fly]");
      flyField.value = "EDITED FLY";
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); };
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 150));
      Storage.prototype.setItem = realSetItem;
      return {
        cached: getLogs().map((entry) => entry.fly),
        onScreen: [...document.querySelectorAll("#log [data-edit-log]")].map((node) =>
          node.closest(".water-card, .log-card")?.textContent || ""),
        message: document.querySelector("#log .log-save-message, #log .subtle")?.textContent || "",
        screenText: document.querySelector("#log").textContent
      };
    });
    assert(result.cached.length === 1 && result.cached[0] === "ORIGINAL FLY",
      `an edit that could not be written is not applied in memory (${result.cached.join(", ")})`);
    assert(!result.screenText.includes("EDITED FLY"),
      "and the edit is not shown as though it had been saved");
    assert(/could not be saved/i.test(result.screenText),
      "the angler is told the write failed");
    await page.close();
  }

  {
    const page = await openApp(browser);
    const result = await page.evaluate(async () => {
      activateTab("log");
      await new Promise((done) => requestAnimationFrame(done));
      document.querySelector("[data-new-log]")?.click();
      await new Promise((done) => requestAnimationFrame(done));
      const form = document.querySelector("#logForm form") || document.querySelector("#logForm");
      form.querySelector("[name=fly]").value = "UNSAVEABLE";
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); };
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 150));
      Storage.prototype.setItem = realSetItem;
      return { cached: getLogs().length, screenText: document.querySelector("#log").textContent };
    });
    assert(result.cached === 0, `a new catch that could not be written is not in the journal (${result.cached})`);
    assert(!result.screenText.includes("UNSAVEABLE"), "and it is not listed on screen either");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A water in Oregon is scored on Oregon time (#1 round six)");

  {
    const readings = {};
    for (const zone of ["America/Los_Angeles", "Asia/Tokyo", "Europe/London"]) {
      const page = await openApp(browser);
      await page.emulateTimezone(zone);
      await page.reload({ waitUntil: "load" });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
      readings[zone] = await page.evaluate(() => {
        const water = waters.find((item) => item.id === "lower-deschutes");
        return {
          hour: currentHour(),
          month: currentMonth(),
          score: fishScore(water),
          window: primeWindowFor(water),
          formTime: zonedTimeLabel(),
          formDate: zonedDateLabel()
        };
      });
      await page.close();
    }
    const zones = Object.keys(readings);
    const pacific = readings["America/Los_Angeles"];
    for (const zone of zones.slice(1)) {
      assert(readings[zone].hour === pacific.hour,
        `${zone}: the hour used for scoring is Oregon's (${readings[zone].hour} vs ${pacific.hour})`);
      assert(readings[zone].score === pacific.score,
        `${zone}: the same river at the same instant scores the same (${readings[zone].score} vs ${pacific.score})`);
      assert(readings[zone].window === pacific.window,
        `${zone}: and the prime-window line agrees (${readings[zone].window})`);
      assert(readings[zone].formDate === pacific.formDate,
        `${zone}: a catch is filed under the same date (${readings[zone].formDate})`);
    }
  }

  /* ---------------------------------------------------------------- */
  group("Nothing is clipped at 320pt - Display Zoom on an SE or mini (#4 round six)");

  {
    const page = await openApp(browser, { viewport: { width: 320, height: 568 } });
    const widths = await page.evaluate(async () => {
      const res = {};
      for (const id of ["today", "waters", "trip", "bugs", "log", "pro"]) {
        activateTab(id);
        await new Promise((done) => setTimeout(done, 80));
        const screen = document.querySelector(`#${id}`);
        res[id] = screen.scrollWidth - screen.clientWidth;
      }
      return res;
    });
    for (const [id, overflow] of Object.entries(widths)) {
      assert(overflow <= 0, `${id} fits a 320pt screen (${overflow}px over)`);
    }
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A pasted link in a catch note does not widen the journal (#5 round six)");

  {
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({
      notes: "Great morning. Report here: https://www.myodfw.com/central-zone-recreation-report/crooked-river-below-bowman-dam-fishing-report-2026",
      fly: "Parachute Adams / Purple Haze Cripple Emerger #18-#22"
    })]);
    const result = await page.evaluate(async () => {
      activateTab("log");
      await new Promise((done) => setTimeout(done, 80));
      const screen = document.querySelector("#log");
      return {
        overflow: screen.scrollWidth - screen.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        showsLink: /myodfw\.com/.test(screen.textContent)
      };
    });
    assert(result.overflow <= 0, `the Log screen still fits the phone (${result.overflow}px over)`);
    assert(result.documentOverflow <= 0, `and nothing runs off the right edge (${result.documentOverflow}px)`);
    assert(result.showsLink, "the note is shown in full rather than truncated");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("The rating breakdown says what it is before you tap it (#2 round six)");

  {
    const page = await openApp(browser);
    const result = await page.evaluate(async () => {
      proAccessActive = true;
      renderAll();
      activateTab("today");
      await new Promise((done) => setTimeout(done, 120));
      const button = document.querySelector("#today [data-score-breakdown]");
      const box = button.getBoundingClientRect();
      const before = document.querySelector("#today").textContent;
      button.click();
      await new Promise((done) => setTimeout(done, 150));
      return {
        labelVisible: /Why this rating/i.test(before),
        tapTarget: `${Math.round(box.width)}x${Math.round(box.height)}`,
        bigEnough: box.width >= 44 && box.height >= 44,
        opens: /Season/.test(document.querySelector("#today").textContent)
          && /Time of day/.test(document.querySelector("#today").textContent)
      };
    });
    assert(result.labelVisible, "the control is labelled 'Why this rating?' before it is tapped");
    assert(result.bigEnough, `and it is a real tap target (${result.tapTarget})`);
    assert(result.opens, "tapping it opens the season and time-of-day breakdown");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A first reading is shown as a reading, and nothing 404s (#3, #6 round six)");

  {
    const page = await openApp(browser);
    const failed = [];
    page.on("requestfailed", (request) => failed.push(request.url()));
    await page.reload({ waitUntil: "load" });
    await page.evaluate(async () => {
      for (const id of ["today", "waters", "trip", "bugs", "log", "pro"]) {
        activateTab(id);
        await new Promise((done) => setTimeout(done, 80));
      }
    });
    const brokenAssets = failed.filter((url) => !url.startsWith("https://") && !url.startsWith("http://"));
    assert(!brokenAssets.length,
      `every asset the app references exists (${brokenAssets.map((url) => url.split("/").pop()).join(", ") || "none missing"})`);

    const history = await page.evaluate(async () => {
      proAccessActive = true;
      recordFlowSample("crooked", { usgs: { flow: "235 cfs" } });
      const one = flowHistoryPanel(waters.find((water) => water.id === "crooked"));
      recordFlowSample("crooked", { usgs: { flow: "260 cfs" } });
      const two = flowHistoryPanel(waters.find((water) => water.id === "crooked"));
      return {
        oneSample: one.replace(/\s+/g, " "),
        twoSamples: two.replace(/\s+/g, " "),
        oneBars: (one.match(/<i /g) || []).length,
        twoBars: (two.match(/<i /g) || []).length,
        stored: flowHistoryFor("crooked").length
      };
    });
    assert(!/No readings recorded yet|One reading recorded so far\./.test(history.oneSample),
      "a recorded reading is not reported as nothing to show");
    assert(/235 cfs/.test(history.oneSample) && history.oneBars === 1,
      `the first reading is shown with its value (${history.oneSample.slice(0, 110)})`);
    assert(history.stored === 2, `a changed reading is kept as its own point (${history.stored})`);
    assert(history.twoBars === 2 && /rising/.test(history.twoSamples),
      `and two readings chart as a trend (${history.twoBars} bars)`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("The app paints under the notch instead of leaving a band (#2 build 14)");

  {
    const source = readFileSync(resolve(root, "the-rise-app.html"), "utf8");
    const viewport = source.match(/<meta name="viewport"[^>]*>/)[0];
    assert(/viewport-fit=cover/.test(viewport),
      `the viewport opts into the full screen (${viewport.slice(0, 76)}...)`);

    const page = await openApp(browser, {
      url: insetAppUrl,
      viewport: { width: 390, height: 844 },
      // A device that has been set up, so Today opens at its top. A fresh
      // install deliberately opens scrolled to the setup panel, which is
      // tested below; what is under test here is where the top edge lands.
      before: () => localStorage.setItem("riseOnboarding.v1", "true")
    });
    // .view.active fades in from translateY(8px). Measuring mid-animation puts
    // every top edge a fraction of a pixel low, which is not what is under
    // test here.
    const settle = () => page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    await settle();
    const today = await page.evaluate(() => {
      const hero = document.querySelector("#today .today-hero");
      const rect = hero.getBoundingClientRect();
      const title = document.querySelector("#today .prime-title").getBoundingClientRect();
      return {
        heroTop: Math.round(rect.top),
        heroColour: getComputedStyle(hero).backgroundColor,
        titleTop: Math.round(title.top),
        bodyColour: getComputedStyle(document.body).backgroundColor
      };
    });
    assert(today.heroTop === 0,
      `the teal hero starts at the very top of the screen (${today.heroTop}px)`);
    assert(today.titleTop >= SAFE_AREA_TOP,
      `and its first line clears the notch (${today.titleTop}px, inset ${SAFE_AREA_TOP}px)`);

    // The band this replaces was the window's own background showing above a
    // teal header. Nothing between y=0 and the inset may be a different colour
    // from the header itself.
    const bandColours = await page.evaluate((inset) => {
      const seen = new Set();
      for (let y = 1; y < inset; y += 6) {
        const element = document.elementFromPoint(195, y);
        if (element) seen.add(getComputedStyle(element.closest("*")).backgroundColor || "");
      }
      return [...seen];
    }, SAFE_AREA_TOP);
    assert(bandColours.every((colour) => colour === "rgba(0, 0, 0, 0)" || colour === today.heroColour),
      `nothing but the header paints the inset strip (${bandColours.join(" | ")})`);

    const tabs = await page.evaluate((inset) => {
      const bar = document.querySelector(".footer-tabs");
      const rect = bar.getBoundingClientRect();
      const lastTab = [...bar.querySelectorAll(".tab")].pop().getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        tabBottom: Math.round(lastTab.bottom),
        clearance: Math.round(rect.bottom - lastTab.bottom),
        inset
      };
    }, SAFE_AREA_BOTTOM);
    assert(tabs.clearance >= SAFE_AREA_BOTTOM,
      `the tab labels clear the home indicator (${tabs.clearance}px of ${SAFE_AREA_BOTTOM}px)`);

    // Every screen, not just Today: the fix is worthless if one tab's header
    // sits under the clock.
    for (const tab of ["waters", "trip", "bugs", "log", "pro"]) {
      await page.evaluate((id) => activateTab(id), tab);
      await settle();
      // The first thing with words on it, wherever the padding happens to sit
      // on that screen - a header's own box may legitimately start at the top
      // edge as long as its text does not.
      const measured = await page.evaluate((id) => {
        const element = document.querySelector(`#${id} .eyebrow, #${id} h1, #${id} h2`);
        return { text: (element.textContent || "").trim().slice(0, 24), top: Math.round(element.getBoundingClientRect().top) };
      }, tab);
      assert(measured.top >= SAFE_AREA_TOP,
        `${tab} starts below the notch ("${measured.text}" at ${measured.top}px)`);
    }

    // And the container is told which glyph colour that screen needs.
    await page.evaluate(() => {
      window.__chrome = [];
      window.webkit = { messageHandlers: { riseChrome: { postMessage: (message) => window.__chrome.push(message.statusBar) } } };
    });
    const perScreen = [];
    for (const tab of ["today", "waters", "trip", "bugs", "log", "pro"]) {
      await page.evaluate((id) => activateTab(id), tab);
      // The screen fades in from translateY(8px); measure the layout it rests
      // in, not the one it passes through.
      await settle();
      perScreen.push(`${tab}:${await page.evaluate(() => statusBarStyleNow())}`);
    }
    assert(perScreen.join(",") === "today:light,waters:light,trip:dark,bugs:dark,log:dark,pro:dark",
      `the status bar follows the screen underneath it (${perScreen.join(",")})`);
    // Repeats are dropped: on a phone this fires once per scrolled frame, and
    // every message crosses into the container.
    const sent = await page.evaluate(() => window.__chrome);
    assert(sent.join(",") === "light,dark",
      `and an unchanged colour is not re-sent (${sent.join(",") || "nothing"})`);
    await page.close();
  }

  /* The bug the simulator found and no test could: the teal is the hero, not
     the screen. Today was registered as a light-glyph screen outright, so
     scrolling past the hero left a white clock on cream - and that is the
     first frame of a fresh install, because the first-run panel sits below the
     hero and the app scrolls down to it. */
  {
    const page = await openApp(browser, { url: insetAppUrl, viewport: { width: 390, height: 844 } });
    const settle = () => page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    /* The assertion is not "Today is light" - that was the bug. It is that the
       colour the container is told matches the colour actually painted in the
       strip the glyphs sit in, at whatever scroll position the app is in. */
    await page.evaluate((inset) => {
      window.__inset = inset;
      /* Sixteen points over the two zones the glyphs occupy - the clock at the
         left, the wifi arc and the battery at the right - read independently
         of the app's own four-point sample, and denser than it. */
      window.__strip = () => {
        const seen = [];
        for (const x of [0.04, 0.08, 0.12, 0.16, 0.84, 0.88, 0.92, 0.96]) {
          for (const fraction of [0.4, 0.6]) {
            let element = document.elementFromPoint(Math.round(window.innerWidth * x), Math.round(inset * fraction));
            while (element) {
              const colour = getComputedStyle(element).backgroundColor;
              const parts = (colour || "").match(/[\d.]+/g);
              if (parts && parts.length >= 3 && (parts.length < 4 || Number(parts[3]) >= 0.5)) { seen.push(colour); break; }
              element = element.parentElement;
            }
          }
        }
        // Rec. 601 luma, the same measure the app uses to make the call.
        const luma = seen.map((colour) => {
          const [r, g, b] = colour.match(/[\d.]+/g).map(Number);
          return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        });
        return {
          colours: [...new Set(seen)],
          // The share of the glyph area each choice would be legible against.
          legible: (style) => luma.filter((value) => (style === "light" ? value < 0.5 : value >= 0.5)).length / luma.length
        };
      };
    }, SAFE_AREA_TOP);

    // A "dark" strip needs light glyphs and vice versa, so the two names are
    // deliberately opposite: painted dark -> statusBar light.
    const agrees = async (label, prepare) => {
      await page.evaluate(prepare);
      await settle();
      const seen = await page.evaluate(() => {
        const strip = window.__strip();
        const style = statusBarStyleNow();
        return {
          colours: strip.colours,
          style,
          legible: strip.legible(style),
          alternative: strip.legible(style === "light" ? "dark" : "light"),
          scrollTop: Math.round(document.querySelector("main").scrollTop)
        };
      });
      /* Where the glyph zones are one colour this is 1 or 0 and the assertion
         is exact. Where a boundary cuts through them neither choice is
         perfect, and the requirement is that the app took the better one. */
      assert(seen.legible >= 0.75 && seen.legible >= seen.alternative,
        `${label}: ${seen.style} glyphs are legible over ${Math.round(seen.legible * 100)}% of where they are drawn ` +
        `(${seen.colours.join(" | ")}, ${seen.scrollTop}px down)`);
      return seen;
    };

    await agrees("at the top of Today", () => { activateTab("today"); });
    await agrees("scrolled past the hero", () => {
      const scroller = document.querySelector("main");
      scroller.scrollTop = document.querySelector("#today .today-hero").getBoundingClientRect().bottom + scroller.scrollTop;
    });
    /* The second thing the simulator caught: the teal ends inside the inset,
       below the glyphs but above its bottom edge. Sampling the strip's bottom
       edge called that cream and drew a dark clock on the last of the teal. */
    await agrees("with the teal ending inside the inset, below the glyphs", () => {
      const scroller = document.querySelector("main");
      // The Today body is pulled up over the hero's bottom padding, so this,
      // not the hero's own bottom, is where the teal stops being visible.
      const teal = document.querySelector("#today .today-body").getBoundingClientRect().top;
      scroller.scrollTop = scroller.scrollTop + teal - window.__inset * 0.85;
    });
    await agrees("scrolled back to the top", () => { document.querySelector("main").scrollTop = 0; });
    await agrees("at the bottom of Today", () => {
      const scroller = document.querySelector("main");
      scroller.scrollTop = scroller.scrollHeight;
    });
    // The launch the simulator showed: a fresh install scrolls itself down to
    // the first-run panel before anyone has touched the screen.
    await agrees("on the first-run panel a fresh install opens at", () => {
      document.querySelector("main").scrollTop = 0;
      scrollAppTo("#today .first-run");
    });
    /* And that panel has to be readable once it is there. The scroller starts
       at the top of the window, so scrolling a target to 12px below the
       scroller's top edge parked "SETUP - 0 OF 3" under the Dynamic Island and
       the Skip button under the battery - on the one screen a fresh install
       opens on. */
    const parked = await page.evaluate(() => {
      const panel = document.querySelector("#today .first-run");
      const skip = panel.querySelector("button");
      return {
        panelTop: Math.round(panel.getBoundingClientRect().top),
        eyebrowTop: Math.round(panel.querySelector(".eyebrow").getBoundingClientRect().top),
        skipTop: Math.round(skip.getBoundingClientRect().top),
        skipLabel: (skip.textContent || "").trim()
      };
    });
    assert(parked.eyebrowTop >= SAFE_AREA_TOP && parked.skipTop >= SAFE_AREA_TOP,
      `and the panel it scrolls to clears the notch ("${parked.skipLabel}" at ${parked.skipTop}px, ` +
      `eyebrow at ${parked.eyebrowTop}px, inset ${SAFE_AREA_TOP}px)`);

    // The scroll listener, not just the function: a finger scroll has to reach
    // the container without anything else being called.
    const live = await page.evaluate(() => new Promise((done) => {
      const sent = [];
      window.webkit = { messageHandlers: { riseChrome: { postMessage: (message) => sent.push(message.statusBar) } } };
      const scroller = document.querySelector("main");
      scroller.scrollTop = 0;
      requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
        // Coalesced to one check per frame, so wait two.
        requestAnimationFrame(() => requestAnimationFrame(() => done(sent)));
      });
    }));
    assert(live.includes("dark"),
      `a scroll alone tells the container (${live.join(",") || "nothing"})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Every control is at least 44x44pt (#3 build 14)");

  {
    for (const width of [320, 390, 430, 768]) {
      const page = await openApp(browser, { viewport: { width, height: 900 } });
      const small = await page.evaluate(() => {
        // Pro on, so the gated panels and their controls are measured too.
        proAccessActive = true;
        renderEverything();
        const undersized = [];
        document.querySelectorAll(".view").forEach((view) => {
          const wasActive = view.classList.contains("active");
          view.classList.add("active");
          view.querySelectorAll("button, a[href], select, input:not([type=hidden]), summary, [role=button]").forEach((element) => {
            const rect = element.getBoundingClientRect();
            if (!rect.width && !rect.height) return;
            // A hit area extended past the visual box with an absolutely
            // positioned ::after counts: the pseudo-element is part of the
            // element for hit testing.
            const after = getComputedStyle(element, "::after");
            const grow = (side) => {
              const value = parseFloat(after[side]);
              return after.content !== "none" && after.position === "absolute" && value < 0 ? -value : 0;
            };
            const width = rect.width + grow("left") + grow("right");
            const height = rect.height + grow("top") + grow("bottom");
            if (width >= 44 && height >= 44) return;
            undersized.push(`${view.id}:${element.className || element.tagName} ${Math.round(width)}x${Math.round(height)}`);
          });
          if (!wasActive) view.classList.remove("active");
        });
        return undersized;
      });
      assert(!small.length,
        `nothing is under 44pt at ${width}pt (${small.slice(0, 3).join(", ") || "none"}${small.length > 3 ? ` +${small.length - 3}` : ""})`);
      await page.close();
    }
  }

  /* ---------------------------------------------------------------- */
  group("A purchase lands the buyer on something they can see (#4 build 14)");

  {
    const page = await openApp(browser, {
      // A phone, because the point of this fix is what fits on one: the Today
      // hero alone is taller than 844px.
      viewport: { width: 390, height: 844 },
      before: () => {
        window.__subscriptionMessages = [];
        window.webkit = {
          messageHandlers: {
            riseSubscription: { postMessage: (message) => window.__subscriptionMessages.push(message) }
          }
        };
      }
    });

    const relaunch = await page.evaluate(() => {
      // What an existing subscriber gets at launch: the reply to the startup
      // status query, not to a purchase.
      window.riseSubscriptionResult({ status: "active", active: true, message: "The Rise Pro is active." });
      return { welcome: Boolean(document.querySelector(".pro-welcome")), pro: proAccessActive };
    });
    assert(relaunch.pro && !relaunch.welcome,
      "relaunching as a subscriber does not replay the welcome");

    const purchase = await page.evaluate(() => {
      proAccessActive = false;
      renderAll();
      activateTab("pro");
      const button = document.querySelector("[data-subscribe-plan]");
      button.removeAttribute("disabled");
      button.click();
      const pending = subscriptionActionPending;
      window.riseSubscriptionResult({ status: "active", active: true, message: "The Rise Pro is active." });
      const panel = document.querySelector(".pro-welcome");
      const panelTop = panel ? panel.getBoundingClientRect().top : Infinity;
      return {
        pending,
        tab: document.querySelector(".view.active").id,
        welcome: Boolean(panel),
        panelTop: Math.round(panelTop),
        // Existing is not enough. Appended below the hero and left at the top
        // of the scroller it landed 1,418px down an 844px screen, which is the
        // unchanged Today screen the buyer was already looking at.
        panelOnScreen: panelTop >= 0 && panelTop < window.innerHeight - 80,
        breakdownRows: document.querySelectorAll("#today .score-breakdown-panel .score-breakdown-row").length,
        destinations: [...document.querySelectorAll(".pro-welcome-item button")]
          .map((button) => button.dataset.tabJump || "breakdown")
      };
    });
    assert(purchase.pending === "purchase" && purchase.tab === "today",
      `a completed purchase moves the buyer off the paywall (${purchase.tab})`);
    assert(purchase.welcome && purchase.breakdownRows > 0,
      `with the rating breakdown open beneath it (${purchase.breakdownRows} rows)`);
    assert(purchase.panelOnScreen,
      `and the panel is on the screen the buyer is looking at (${purchase.panelTop}px of 844px)`);
    assert(purchase.destinations.join(",") === "waters,breakdown,trip,bugs",
      `and a route to each of the four unlocks (${purchase.destinations.join(",")})`);

    // The one row that does not switch tabs has to move the screen instead, or
    // "Show me" appears to do nothing.
    const shown = await page.evaluate(() => {
      document.querySelector(".pro-welcome-item [data-show-breakdown]").click();
      const panel = document.querySelector("#today .score-breakdown-panel");
      return Math.round(panel.getBoundingClientRect().top);
    });
    assert(shown >= 0 && shown < 200,
      `Show me brings the rating breakdown to the top of the screen (${shown}px)`);

    const dismissed = await page.evaluate(() => {
      document.querySelector("[data-dismiss-pro-welcome]").click();
      return Boolean(document.querySelector(".pro-welcome"));
    });
    assert(!dismissed, "one tap removes it");

    const cancelled = await page.evaluate(() => {
      proAccessActive = false;
      proWelcomeOpen = false;
      renderAll();
      activateTab("pro");
      const button = document.querySelector("[data-subscribe-plan]");
      button.removeAttribute("disabled");
      button.click();
      window.riseSubscriptionResult({ status: "cancelled", active: false, message: "Purchase cancelled." });
      // A later status refresh must not inherit the cancelled purchase.
      window.riseSubscriptionResult({ status: "active", active: true, message: "The Rise Pro is active." });
      return Boolean(document.querySelector(".pro-welcome"));
    });
    assert(!cancelled, "a cancelled purchase cannot arm it for the next reply");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A fresh install is told what to set up (#5 build 14)");

  {
    const page = await openApp(browser, { viewport: { width: 390, height: 844 } });
    const fresh = await page.evaluate(() => {
      const panel = document.querySelector("#today .first-run");
      const top = panel ? panel.getBoundingClientRect().top : Infinity;
      return {
        shown: Boolean(panel),
        top: Math.round(top),
        // The Today hero is taller than a phone screen, so a setup panel
        // rendered below it is not on the screen the app opened on.
        onScreen: top >= 0 && top < window.innerHeight - 80,
        steps: [...document.querySelectorAll(".first-run-step")].map((step) => step.dataset.step),
        done: [...document.querySelectorAll(".first-run-step.done")].length,
        actions: [...document.querySelectorAll(".first-run-step button")].map((button) =>
          button.dataset.refreshAll !== undefined ? "refresh"
            : button.dataset.useLocation !== undefined ? "location"
            : button.dataset.tabJump || "?")
      };
    });
    assert(fresh.shown && fresh.steps.join(",") === "readings,location,log",
      `a fresh install opens with the three setup steps (${fresh.steps.join(",")})`);
    assert(fresh.done === 0, `none of them claim to be done (${fresh.done})`);
    assert(fresh.onScreen, `and a fresh install opens on it (${fresh.top}px of 844px)`);
    assert(fresh.actions.join(",") === "refresh,location,log",
      `each step carries the button that performs it (${fresh.actions.join(",")})`);

    const logged = await page.evaluate(() => {
      setLogs([{ loggedAt: "2026-09-01T18:00:00.000Z", date: "Sep 1, 2026", waterName: "Crooked River", waterId: "crooked", fly: "X-Caddis #16", fish: "Redband Trout" }]);
      renderToday();
      return [...document.querySelectorAll(".first-run-step")].map((step) => `${step.dataset.step}:${step.classList.contains("done")}`);
    });
    assert(logged.join(",") === "readings:false,location:false,log:true",
      `a step checks itself off when it is actually done (${logged.join(", ")})`);

    const skipped = await page.evaluate(() => {
      document.querySelector("[data-dismiss-onboarding]").click();
      return { gone: !document.querySelector(".first-run"), stored: localStorage.getItem("riseOnboarding.v1") };
    });
    assert(skipped.gone && skipped.stored === "true", "Skip removes it and remembers");

    await page.reload({ waitUntil: "load" });
    const afterReload = await page.evaluate(() => Boolean(document.querySelector(".first-run")));
    assert(!afterReload, "and it stays gone across a relaunch");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("A long journal renders a page at a time (#5 build 14)");

  {
    const page = await openApp(browser);
    await page.evaluate(() => localStorage.setItem("riseOnboarding.v1", "true"));
    const seed = [];
    for (let index = 0; index < 500; index += 1) {
      seed.push(sampleEntryFor(index));
    }
    await seedLogs(page, seed);

    const paged = await page.evaluate(() => {
      activateTab("log");
      const start = performance.now();
      for (let run = 0; run < 5; run += 1) renderLog();
      const pagedMs = (performance.now() - start) / 5;
      logVisibleCount = 500;
      const unpagedStart = performance.now();
      for (let run = 0; run < 5; run += 1) renderLog();
      const unpagedMs = (performance.now() - unpagedStart) / 5;
      logVisibleCount = 40;
      renderLog();
      return {
        pagedMs,
        unpagedMs,
        cards: document.querySelectorAll("#log .catch-card").length,
        fish: document.querySelector("#log .log-stat strong").textContent,
        header: document.querySelector("#log .log-top .subtle").textContent,
        note: document.querySelector(".log-more .subtle")?.textContent || ""
      };
    });
    assert(paged.cards === 40, `500 entries put 40 cards in the DOM (${paged.cards})`);
    assert(paged.pagedMs * 2 < paged.unpagedMs,
      `which is the render cost that matters (${Math.round(paged.pagedMs)}ms paged vs ${Math.round(paged.unpagedMs)}ms whole)`);
    assert(paged.fish === "500" && /500 entries kept/.test(paged.header),
      `the counts still run over the whole journal (${paged.fish} fish)`);
    assert(/Showing 40 of 500/.test(paged.note),
      `and the screen says so rather than implying the rest are gone (${paged.note.trim().slice(0, 60)})`);

    const more = await page.evaluate(() => {
      document.querySelector("[data-show-more-log]").click();
      return document.querySelectorAll("#log .catch-card").length;
    });
    assert(more === 80, `Show more adds a page (${more})`);

    // Paging slices from the front, so a card's index is still its index in
    // the journal. If that ever stops being true, Delete removes a stranger.
    const deleted = await page.evaluate(() => {
      const before = getLogs();
      const target = before[1].fly;
      document.querySelectorAll("[data-delete-log]")[1].click();
      const after = getLogs();
      return { before: before.length, after: after.length, target, stillPresent: after.some((entry) => entry.fly === target) };
    });
    assert(deleted.after === deleted.before - 1 && !deleted.stillPresent,
      `Delete on a paged list removes the entry it points at (${deleted.target})`);

    const exported = await page.evaluate(() => {
      let csv = null;
      window.webkit = { messageHandlers: { riseStore: { postMessage: (message) => { if (message.action === "exportLog") csv = message.body; } } } };
      document.querySelector("[data-export-log]").click();
      return csv ? csv.trim().split("\n").length - 1 : 0;
    });
    assert(exported === 499, `and the export still carries every entry (${exported})`);
    await page.close();
  }

} finally {
  for (const context of openContexts) {
    await context.close().catch(() => {});
  }
  await browser.close();
  if (!process.env.RISE_DOM_TEST_WORKDIR) rmSync(workRoot, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
