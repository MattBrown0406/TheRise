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

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
const appUrl = pathToFileURL(stagedApp).href;

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

async function openApp(browser, { fetchPlan, viewport } = {}) {
  const context = await browser.createBrowserContext();
  openContexts.push(context);
  const page = await context.newPage();
  await page.setViewport(viewport || { width: 430, height: 932 });
  await page.evaluateOnNewDocument(instrumentation);
  if (fetchPlan) {
    await page.evaluateOnNewDocument((plan) => {
      window.addEventListener("DOMContentLoaded", () => {});
      Object.defineProperty(window, "__pendingFetchPlan", { value: plan, writable: true });
    }, fetchPlan);
  }
  await page.goto(appUrl, { waitUntil: "load" });
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
        || (() => { setActiveWater(target.id); return null; })();
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

} finally {
  for (const context of openContexts) {
    await context.close().catch(() => {});
  }
  await browser.close();
  if (!process.env.RISE_DOM_TEST_WORKDIR) rmSync(workRoot, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
