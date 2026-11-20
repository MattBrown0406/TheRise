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

/* A seven-day NWS /forecast response, dated from today in Oregon, served
   in front of the instrumentation's scripted fetch. Day and night periods
   alternate as they do from api.weather.gov; the third day is windy and the
   fifth snows, so the planner has something to rank. */
const dailyForecastFixture = `
  (() => {
    const scripted = window.fetch;
    window.__dailyForecasts = 0;
    window.fetch = function (url) {
      const href = String(url);
      if (!/^https:\\/\\/api\\.weather\\.gov\\/gridpoints\\/.*\\/forecast$/.test(href)) return scripted.call(this, url);
      window.__requests.push(href);
      window.__dailyForecasts += 1;
      if (window.__fetchPlan.mode === "offline") return Promise.reject(new TypeError("Failed to fetch"));
      const format = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
      const skies = ["Mostly Cloudy", "Sunny", "Chance Thunderstorms", "Partly Sunny", "Snow", "Cloudy", "Sunny"];
      const periods = [];
      for (let index = 0; index < 7; index += 1) {
        const date = format.format(new Date(Date.now() + index * 86400000));
        periods.push({ name: "Day " + index, startTime: date + "T06:00:00-08:00", isDaytime: true, temperature: 55, temperatureUnit: "F",
          windSpeed: index === 2 ? "20 to 25 mph" : "5 to 10 mph", shortForecast: skies[index], probabilityOfPrecipitation: { value: 20 } });
        periods.push({ name: "Night " + index, startTime: date + "T18:00:00-08:00", isDaytime: false, temperature: 35, temperatureUnit: "F",
          windSpeed: "5 mph", shortForecast: "Clear" });
      }
      return Promise.resolve(new Response(JSON.stringify({ properties: { periods } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    };
  })();
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

    /* The panel clearing the notch does not mean the strip above it is empty.
       The scroller runs the full height of the window, so whatever precedes the
       panel passes under the glyphs - on the simulator, a Pro card's body text
       with the clock printed across it. */
    const scrim = await page.evaluate((inset) => {
      const element = document.querySelector(".status-bar-scrim");
      if (!element) return { missing: true };
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // Something from the scroller really is passing through the strip here.
      let intruding = null;
      for (const node of document.querySelectorAll("#today *")) {
        const text = (node.textContent || "").trim();
        if (!text || node.children.length) continue;
        const rect = node.getBoundingClientRect();
        if (rect.top < inset && rect.bottom > 0 && rect.height > 0) {
          intruding = text.slice(0, 40);
          break;
        }
      }
      /* pointer-events:none is what keeps the sampler honest: elementFromPoint
         has to reach past the scrim to the thing whose colour decides the
         glyphs, at both zones and both heights it samples. */
      const sampled = [];
      for (const x of [0.1, 0.9]) {
        for (const fraction of [0.4, 0.6]) {
          const hit = document.elementFromPoint(Math.round(window.innerWidth * x), Math.round(inset * fraction));
          sampled.push(hit ? hit.className || hit.tagName : "none");
        }
      }
      return {
        left: Math.round(box.left),
        width: Math.round(box.width),
        screenWidth: window.innerWidth,
        height: Math.round(box.height),
        blurred: (style.backdropFilter || style.webkitBackdropFilter || "").includes("blur"),
        zIndex: Number(style.zIndex),
        contentZ: Number(getComputedStyle(document.querySelector("main")).zIndex) || 0,
        hitsScrim: sampled.some((name) => String(name).includes("status-bar-scrim")),
        intruding
      };
    }, SAFE_AREA_TOP);
    assert(!scrim.missing && scrim.left === 0 && scrim.width === scrim.screenWidth && scrim.height >= SAFE_AREA_TOP,
      `and the strip above it is covered edge to edge (${scrim.width}x${scrim.height}px at x=${scrim.left}, inset ${SAFE_AREA_TOP}px)`);
    assert(scrim.blurred && scrim.zIndex > scrim.contentZ,
      `by a blur that paints over the scroller (z-index ${scrim.zIndex} over ${scrim.contentZ})`);
    assert(scrim.intruding !== null,
      `which is not hypothetical - "${scrim.intruding}" is inside the strip at that scroll position`);
    assert(!scrim.hitsScrim,
      "and the scrim is never hit-tested, so the glyph colour is still read off what is behind it");

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

    /* And a re-render alone, with no scroll at all. At boot the app measures a
       Today built from reference values; the first sync then replaces that
       screen under the status bar, and on the simulator nothing looked again -
       one dark clock on teal for the rest of the launch. */
    const rerendered = await page.evaluate(() => {
      const sent = [];
      window.webkit = { messageHandlers: { riseChrome: { postMessage: (message) => sent.push(message.statusBar) } } };
      activateTab("today");
      const scroller = document.querySelector("main");
      scroller.scrollTop = scroller.scrollHeight;
      // Pretend the last answer was the one the boot layout produced.
      lastStatusBarStyle = "light";
      sent.length = 0;
      renderScreen("today");
      return { sent, atTop: (scroller.scrollTop = 0, lastStatusBarStyle) };
    });
    assert(rerendered.sent.includes("dark"),
      `a re-render of the visible screen tells the container too (${rerendered.sent.join(",") || "nothing"})`);

    /* That re-render also moves the panel the app scrolled to, because the
       hero above it changes height when the readings land. On the simulator
       the panel's top corner drifted back under the notch. */
    const settled = await page.evaluate(() => {
      const scroller = document.querySelector("main");
      scroller.scrollTop = 0;
      firstRunScrollPending = true;
      scrollAppTo("#today .first-run");
      const top = () => Math.round(document.querySelector("#today .first-run").getBoundingClientRect().top);
      // The drift a shorter hero causes, without depending on a live sync. A
      // launch renders Today more than once, so both have to be corrected.
      scroller.scrollTop += 40;
      const drifted = top();
      renderScreen("today");
      const corrected = top();
      scroller.scrollTop += 40;
      renderScreen("today");
      const stillCorrected = top();
      // Until a finger arrives, at which point the position is the angler's.
      window.dispatchEvent(new Event("touchstart"));
      scroller.scrollTop += 40;
      renderScreen("today");
      return { drifted, corrected, stillCorrected, afterTouch: top() };
    });
    assert(settled.drifted < SAFE_AREA_TOP && settled.corrected >= SAFE_AREA_TOP && settled.stillCorrected >= SAFE_AREA_TOP,
      `and the panel is held below the notch through the renders a launch does ` +
      `(${settled.drifted}px, then ${settled.corrected}px and ${settled.stillCorrected}px, inset ${SAFE_AREA_TOP}px)`);
    assert(settled.afterTouch < settled.corrected,
      `and released the moment the screen is touched (${settled.afterTouch}px)`);
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
        // Snap a bug only shows its questions, results and the log form's
        // attached-photo row once there is a photo, so one is staged.
        const photo = document.createElement("canvas");
        photo.width = 120;
        photo.height = 80;
        photo.getContext("2d").fillRect(0, 0, 120, 80);
        snapBug = { status: "ready", photo: photo.toDataURL("image/jpeg"), error: "", sample: { r: 100, g: 120, b: 40, hex: "#647828", fx: .5, fy: .5 }, autoColor: "olive" };
        snapTraits = { color: "olive", size: "s16", shape: "upright", tails: "3" };
        pendingCatchPhoto = snapBug.photo;
        logFormOpen = true;
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

  group("Launch and storage failure audit");
  {
    const page = await openApp(browser, { before: () => {
      window.__launchErrors = [];
      window.addEventListener("error", event => window.__launchErrors.push(event.message));
      window.webkit = { messageHandlers: { riseSubscription: { postMessage() { throw new Error("bridge disconnected"); } } } };
    } });
    const state = await page.evaluate(() => ({ errors: window.__launchErrors, loading: subscriptionLoading, requests: window.__requests.length }));
    assert(state.errors.length === 0 && !state.loading && state.requests > 0,
      `a throwing subscription bridge cannot abort startup or wedge checkout (${JSON.stringify(state)})`);
    await page.close();
  }
  {
    const page = await openApp(browser);
    const state = await page.evaluate(() => {
      riseSubscriptionResult({ status: "error", message: '<img id="bridge-injection" src=x onerror="window.__injected=1">' });
      return { injected: !!document.querySelector("#bridge-injection"), text: document.querySelector(".pro-status").textContent };
    });
    assert(!state.injected && state.text.includes("<img"), "subscription error messages render as text, never markup");
    const failed = await page.evaluate(() => {
      setLogs([{ fly: "KEEP" }]);
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("quota"); };
      window.webkit = { messageHandlers: { riseStore: { postMessage() { throw new Error("disconnected"); } } } };
      const saved = setLogs([{ fly: "LOST" }]);
      Storage.prototype.setItem = set;
      return { saved, fly: getLogs()[0].fly };
    });
    assert(!failed.saved && failed.fly === "KEEP", "a throwing storage bridge plus full quota does not claim a durable save");
    const bridgeFailures = await page.evaluate(async () => {
      let photoRejected = false;
      try { await storePhoto("data:image/jpeg;base64,AA=="); } catch { photoRejected = true; }
      return { photoRejected, exportMessage: exportLog() };
    });
    assert(bridgeFailures.photoRejected && /failed/i.test(bridgeFailures.exportMessage),
      "throwing native photo/export bridges do not report success");
    await page.close();
  }
  {
    const page = await openApp(browser, { before: () => {
      window.__launchErrors = [];
      window.addEventListener("error", event => window.__launchErrors.push(event.message));
      localStorage.setItem("riseWaterReports.v1", JSON.stringify({ byWater: { "lower-deschutes": { errors: "broken", nws: { wind: {} } } }, localIntel: { byWater: { "lower-deschutes": { hatches: {}, flies: {}, sources: {} } } } }));
    } });
    const state = await page.evaluate(() => {
      let navigationError = "";
      try { for (const tab of ["today", "waters", "trip", "bugs", "log", "pro"]) activateTab(tab); }
      catch (error) { navigationError = error.message; }
      return { errors: window.__launchErrors, navigationError };
    });
    assert(!state.errors.length && !state.navigationError, `malformed cached reports cannot break startup/navigation (${JSON.stringify(state)})`);
    const flow = await page.evaluate(() => {
      localStorage.setItem(FLOW_HISTORY_KEY, JSON.stringify({ "lower-deschutes": [null, { f: {} }, { d: "2026-06-21", f: 235 }] }));
      proAccessActive = true;
      try { return { html: flowHistoryPanel(waterById("lower-deschutes")) }; }
      catch (error) { return { error: error.message }; }
    });
    assert(!flow.error && flow.html.includes("235 cfs"), `malformed flow samples do not hide valid readings (${flow.error || "rendered"})`);
    const cacheMarkup = await page.evaluate(() => {
      const bad = '<img data-cache-injection src=x onerror="window.__cacheInjected=1">';
      localStorage.setItem(WATER_REPORT_CACHE_KEY, JSON.stringify({ byWater: { crooked: { nws: { forecast: bad, air: "60 F", wind: "5 mph" }, errors: [] } } }));
      hydrateWaterCache();
      saveActiveWater("crooked");
      renderEverything();
      return !!document.querySelector("[data-cache-injection]");
    });
    assert(!cacheMarkup, "cached remote report text cannot inject markup into any screen");
    const cacheType = await page.evaluate(() => {
      localStorage.setItem(WATER_REPORT_CACHE_KEY, JSON.stringify({ byWater: { crooked: { nws: { forecast: 123 }, errors: [] } } }));
      hydrateWaterCache();
      try { renderEverything(); return ""; } catch (error) { return error.message; }
    });
    assert(!cacheType, `cached forecast types are validated before string operations (${cacheType || "rendered"})`);
    await page.close();
  }
  {
    const page = await openApp(browser);
    const state = await page.evaluate(async () => {
      activateTab("log");
      document.querySelector("[data-new-log]").click();
      const form = document.querySelector("#logForm");
      form.elements.fly.value = "DRAFT FLY";
      form.elements.notes.value = "Do not lose this note";
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("quota"); };
      await saveLogEntry(form);
      Storage.prototype.setItem = set;
      return { fly: document.querySelector('#logForm [name="fly"]').value,
        notes: document.querySelector('#logForm [name="notes"]').value,
        message: document.querySelector('#logForm [role="alert"]')?.textContent || "", count: getLogs().length };
    });
    assert(state.fly === "DRAFT FLY" && state.notes === "Do not lose this note" && state.message && state.count === 0,
      `failed journal saves keep the exact draft for retry (${JSON.stringify(state)})`);
    const rejected = await page.evaluate(async () => {
      const form = document.querySelector("#logForm");
      form.elements.notes.value = "Photo error draft";
      const read = readPhotoFile;
      readPhotoFile = () => Promise.reject(new Error("decode failed"));
      let rejected = false;
      try { await saveLogEntry(form); } catch { rejected = true; }
      readPhotoFile = read;
      return { rejected, note: document.querySelector('#logForm [name="notes"]').value,
        busy: logSaveInFlight, message: document.querySelector('#logForm [role="alert"]')?.textContent || "" };
    });
    assert(!rejected.rejected && !rejected.busy && rejected.note === "Photo error draft" && rejected.message,
      "unexpected asynchronous save failures are shown without throwing or losing the draft");
    await page.close();
  }

  group("Journal recovery and asynchronous draft lifetimes");
  {
    const page = await openApp(browser);
    const recovery = await page.evaluate(() => {
      setLogs([{ fly: "deleted on native" }]);
      localStorage.setItem(LOG_SAVED_AT_KEY, "2026-01-01T00:00:00.000Z");
      riseLogRestore({ body: JSON.stringify({ savedAt: "2026-02-01T00:00:00.000Z", logs: [] }) });
      return getLogs().length;
    });
    assert(recovery === 0, "a provably newer empty native journal restores deletions too");
    const invalidDate = await page.evaluate(() => {
      setLogs([{ fly: "KEEP" }]);
      riseLogRestore({ body: JSON.stringify({ savedAt: "zzz-invalid", logs: [{ fly: "WRONG" }] }) });
      return getLogs()[0].fly;
    });
    assert(invalidDate === "KEEP", "an invalid backup timestamp cannot overwrite the current journal");
    const metadata = await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === LOG_SAVED_AT_KEY) throw new Error("metadata quota");
        return real.call(this, key, value);
      };
      const saved = setLogs([{ fly: "PERSISTED" }]);
      Storage.prototype.setItem = real;
      return { saved, memory: getLogs()[0].fly, stored: JSON.parse(localStorage.getItem(LOG_STORAGE_KEY))[0].fly };
    });
    assert(metadata.saved && metadata.memory === metadata.stored, "a metadata-only failure does not disagree with the journal write that already landed");
    await page.close();
  }
  {
    const page = await openApp(browser);
    const draft = await page.evaluate(async () => {
      activateTab("log");
      document.querySelector("[data-new-log]").click();
      const form = document.querySelector("#logForm");
      form.elements.notes.value = "Photo draft";
      const transfer = new DataTransfer();
      transfer.items.add(new File(["not an image"], "bad.jpg", { type: "image/jpeg" }));
      form.elements.photo.files = transfer.files;
      renderAll();
      const retained = document.querySelector("#logForm") === form && form.elements.photo.files.length === 1;
      await saveLogEntry(form);
      return { retained, count: getLogs().length, formPresent: !!document.querySelector("#logForm"),
        message: document.querySelector('[data-log-save-error]')?.textContent || "" };
    });
    assert(draft.retained, "background repaint keeps the real form and its selected photo");
    assert(draft.count === 0 && draft.formPresent && draft.message, "an unreadable selected photo fails visibly instead of silently saving without it");
    const canceled = await page.evaluate(async () => {
      logFormOpen = true;
      renderLog();
      const form = document.querySelector("#logForm");
      form.elements.notes.value = "Canceled photo save";
      let finish;
      const read = readPhotoFile;
      readPhotoFile = () => new Promise(resolve => { finish = resolve; });
      const saving = saveLogEntry(form);
      logFormOpen = false;
      renderLog();
      logFormOpen = true;
      renderLog();
      document.querySelector('#logForm [name="notes"]').value = "New draft";
      finish("");
      await saving;
      readPhotoFile = read;
      return { count: getLogs().length, notes: document.querySelector('#logForm [name="notes"]')?.value };
    });
    assert(canceled.count === 0 && canceled.notes === "New draft", "closing a pending save cancels that form's continuation without closing a later draft");
    await page.close();
  }

  group("Native disk acknowledgment boundaries");
  {
    const page = await openApp(browser);
    const result = await page.evaluate(async () => {
      setLogs([{ fly: "KEEP" }]);
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("quota"); };
      const sent = [];
      window.webkit = { messageHandlers: { riseStore: { postMessage: payload => sent.push(payload) } } };
      const saved = setLogs([{ fly: "UNCONFIRMED" }]);
      Storage.prototype.setItem = real;
      return { saved, fly: getLogs()[0].fly, writes: sent.length };
    });
    assert(!result.saved && result.fly === "KEEP" && result.writes === 0,
      "unacknowledged native delivery cannot substitute for a failed journal write");
    const photo = await page.evaluate(async () => {
      window.webkit.messageHandlers.riseStore.postMessage = payload => {
        if (payload.action === "savePhoto") setTimeout(() => window.risePhotoSaveResult?.({ id: payload.id, ok: false }), 0);
      };
      try { await storePhoto("data:image/jpeg;base64,/9j/AA=="); return false; } catch { return true; }
    });
    assert(photo, "a native disk-write failure rejects the photo rather than saving a missing file reference");
    const ack = await page.evaluate(async () => {
      window.webkit.messageHandlers.riseStore.postMessage = payload => {
        if (payload.action === "savePhoto") setTimeout(() => risePhotoSaveResult({ id: payload.id, ok: true }), 0);
      };
      const fields = await storePhoto("data:image/jpeg;base64,/9j/AA==");
      return fields.photoId.startsWith("catch-") && fields.photo === "" && pendingPhotoSaves.size === 0;
    });
    assert(ack, "a positive native disk acknowledgment releases a photo reference and cleans the pending request");
    const timeout = await page.evaluate(async () => {
      window.webkit.messageHandlers.riseStore.postMessage = () => {};
      try { await storePhoto("data:image/jpeg;base64,/9j/AA=="); return false; }
      catch { return pendingPhotoSaves.size === 0; }
    });
    assert(timeout, "a dropped native photo acknowledgment times out without claiming success");
    const race = await page.evaluate(async () => {
      activateTab("log");
      document.querySelector("[data-new-log]").click();
      const form = document.querySelector("#logForm");
      const read = readPhotoFile;
      readPhotoFile = async () => "data:image/jpeg;base64,/9j/AA==";
      let pendingId;
      const removed = [];
      window.webkit.messageHandlers.riseStore.postMessage = p => {
        if (p.action === "savePhoto") pendingId = p.id;
        if (p.action === "deletePhoto") removed.push(p.id);
      };
      const save = saveLogEntry(form);
      await new Promise(resolve => setTimeout(resolve, 0));
      setLogs([{ fly: "CONCURRENT" }]);
      risePhotoSaveResult({ id: pendingId, ok: true });
      await save;
      readPhotoFile = read;
      return getLogs()[0].fly === "CONCURRENT" && getLogs().length === 1 && removed.includes(pendingId) && form.isConnected;
    });
    assert(race, "a journal change during native photo IO preserves the newer journal and draft, removing only the new orphan");
    await page.close();
  }

  group("Corrupt journals are preserved, not treated as empty");
  {
    const page = await openApp(browser, { before: () => {
      localStorage.setItem("riseLogs", '{"unsupported":"journal payload"}');
    } });
    const state = await page.evaluate(() => {
      activateTab("log");
      const original = localStorage.getItem(LOG_STORAGE_KEY);
      const saved = setLogs([{ fly: "would erase original" }]);
      return { saved, unchanged: original === localStorage.getItem(LOG_STORAGE_KEY), notice: document.querySelector("#log").textContent };
    });
    assert(!state.saved && state.unchanged && /could not be read/i.test(state.notice),
      "unsupported journal storage blocks overwrites and explains recovery without erasing the original");
    await page.close();
  }
  {
    const page = await openApp(browser);
    const state = await page.evaluate(() => {
      setLogs([{ fly: "KEEP" }]);
      riseLogRestore({ body: JSON.stringify({ savedAt: "2099-01-01T00:00:00.000Z", logs: [null, "bad"] }) });
      return getLogs()[0]?.fly;
    });
    assert(state === "KEEP", "an invalid backup cannot become an empty journal and erase catches");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Audit 2026-11-18: journal edits, restores and purchase replies");
  {
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ flowSource: "measured", tempSource: "measured" })]);
    const moved = await page.evaluate(async () => {
      activateTab("log");
      document.querySelector("[data-edit-log]").click();
      await new Promise((done) => requestAnimationFrame(done));
      const select = document.querySelector("#logForm [name=water]");
      select.value = "crane-prairie";
      document.querySelector("#logForm").requestSubmit();
      await new Promise((done) => setTimeout(done, 300));
      const entry = getLogs()[0];
      return { water: entry.waterId, flow: entry.flow, flowSource: entry.flowSource, card: document.querySelector("#log .catch-card")?.textContent || "" };
    });
    assert(moved.water === "crane-prairie", `the edit moved the catch (${moved.water})`);
    assert(!moved.flow && moved.flowSource === "unavailable",
      `moving a catch to another water drops the old water's readings (${moved.flow} / ${moved.flowSource})`);
    assert(!/235 cfs/.test(moved.card), "the card no longer shows the river's flow on a reservoir");
    await page.close();
  }
  {
    const page = await openApp(browser);
    const restored = await page.evaluate(async () => {
      activateTab("today");
      const before = Boolean(document.querySelector("#today .first-run"));
      window.riseLogRestore({ body: JSON.stringify({ savedAt: new Date().toISOString(), logs: [{
        loggedAt: "2026-06-21T18:00:00.000Z", date: "Jun 21, 2026", time: "6:00 PM", waterName: "Crooked River",
        waterId: "crooked", fly: "Zebra Midge #18", fish: "Redband Trout", length: "14", count: "1", notes: "", flow: "", temp: ""
      }] }) });
      await new Promise((done) => requestAnimationFrame(done));
      const panel = document.querySelector("#today .first-run")?.textContent || "";
      return { before, pending: firstRunScrollPending, panel };
    });
    assert(restored.before, "a fresh install shows the setup panel");
    assert(!restored.pending, "a restored journal cancels the pending scroll to the setup panel");
    assert(!/0 of 3/i.test(restored.panel), `Today is repainted after a restore (${restored.panel.slice(0, 80)})`);
    await page.close();
  }
  {
    const page = await openApp(browser, {
      before: () => {
        window.__subscriptionMessages = [];
        window.webkit = { messageHandlers: { riseSubscription: { postMessage: (message) => window.__subscriptionMessages.push(message) } } };
      }
    });
    const race = await page.evaluate(() => {
      window.riseSubscriptionResult({ action: "status", status: "inactive", active: false, message: "The Rise Pro is not active yet.", prices: { monthly: "$6.99", annual: "$49.99" } });
      activateTab("pro");
      const button = document.querySelector("[data-subscribe-plan]");
      button.click();
      // A status check answered while the App Store sheet is still up.
      window.riseSubscriptionResult({ action: "status", status: "inactive", active: false, message: "The Rise Pro is not active yet." });
      const midCheckout = {
        disabled: document.querySelector("[data-subscribe-plan]").disabled,
        pending: subscriptionActionPending
      };
      window.riseSubscriptionResult({ action: "purchase", status: "active", active: true, message: "The Rise Pro is active." });
      return { midCheckout, welcome: Boolean(document.querySelector(".pro-welcome")) };
    });
    assert(race.midCheckout.disabled && race.midCheckout.pending === "purchase",
      "a status reply during checkout does not re-enable Subscribe or end the purchase");
    assert(race.welcome, "the purchase's own reply still lands the buyer on what it unlocked");
    const pending = await page.evaluate(() => {
      proAccessActive = false;
      renderAll();
      activateTab("pro");
      document.querySelector("[data-subscribe-plan]").click();
      window.riseSubscriptionResult({ action: "purchase", status: "pending", active: false, message: "Your purchase is waiting for approval." });
      return { pro: proAccessActive, text: document.querySelector("#pro").textContent };
    });
    assert(!pending.pro && /waiting for approval/.test(pending.text), "Ask to Buy reads as waiting, not failed");
    await page.close();
  }
  {
    const page = await openApp(browser);
    const today = await page.evaluate(() => {
      activateTab("today");
      return document.querySelector("#today").textContent;
    });
    assert(!/since dawn/.test(today) && !/AI-matched/.test(today), "Today shows no invented temperature trend or AI claim");
    assert(/seasonal reference|measured/.test(today), "the condition cards say where each number came from");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Plan the week: fetched on request, scored from the forecast, honest when it cannot be");

  {
    const page = await openApp(browser, { before: dailyForecastFixture, viewport: { width: 390, height: 844 } });
    const opened = await page.evaluate(async () => {
      localStorage.setItem("riseSavedWaters.v1", JSON.stringify(["metolius", "hosmer", "crooked"]));
      return true;
    });
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    const idle = await page.evaluate(() => ({
      panel: Boolean(document.querySelector("#today .planner")),
      button: document.querySelector("#today [data-plan-week]")?.textContent.trim(),
      rows: document.querySelectorAll("#today .planner-day").length,
      dailyRequests: window.__requests.filter((url) => /\/forecast$/.test(url)).length
    }));
    assert(opened && idle.panel, "the Plan the week panel is on Today");
    assert(idle.button === "Plan the week", `it waits to be asked (${idle.button})`);
    assert(idle.rows === 0, "nothing is shown before a forecast is loaded");
    assert(idle.dailyRequests === 0, `opening the app fetches no planner forecast (${idle.dailyRequests})`);

    const loaded = await page.evaluate(async () => {
      window.__fetchPlan = { mode: "online", body: "" };
      window.__requests.length = 0;
      window.__dailyForecasts = 0;
      const before = window.__listenerCount(document, "click");
      document.querySelector("#today [data-plan-week]").click();
      await new Promise((done) => setTimeout(done, 50));
      await (plannerInFlight || Promise.resolve());
      await new Promise((done) => requestAnimationFrame(done));
      const waterCards = [...document.querySelectorAll("#today .planner-water")];
      const today = pacificDateKey();
      return {
        listenersAdded: window.__listenerCount(document, "click") - before,
        waters: waterCards.map((card) => card.dataset.plannerWater),
        dayCounts: waterCards.map((card) => card.querySelectorAll(".planner-day").length),
        bestCounts: waterCards.map((card) => card.querySelectorAll(".planner-day.best").length),
        openDayCounts: waterCards.map((card) => card.querySelectorAll(".planner-day:not(.closed)").length),
        closedRows: [...document.querySelectorAll("#today .planner-day.closed")].map((row) => row.textContent.replace(/\s+/g, " ").trim()),
        expectedClosed: plannerWaters().reduce((sum, water) => sum + plannerForWater(water, today).days.filter((day) => day.closure).length, 0),
        firstReason: document.querySelector("#today .planner-day:not(.closed) span")?.textContent || "",
        dailyRequests: window.__dailyForecasts,
        tripcheck: document.querySelector("#today .planner-access a[href]")?.getAttribute("href") || "",
        status: document.querySelector("#today .planner-status")?.textContent || "",
        disclaimer: document.querySelector("#today .planner-head .subtle")?.textContent || ""
      };
    });
    assert(loaded.listenersAdded === 0, "loading the planner attaches no listener");
    assert(loaded.waters[0] === "lower-deschutes" && loaded.waters.includes("metolius") && loaded.waters.includes("hosmer"),
      `home, top pick and saved waters are planned (${loaded.waters.join(", ")})`);
    assert(loaded.waters.length <= 8, `at most eight waters (${loaded.waters.length})`);
    assert(loaded.dayCounts.every((count) => count === 7), `each water shows seven days (${loaded.dayCounts.join(",")})`);
    assert(loaded.bestCounts.every((count, index) => count === (loaded.openDayCounts[index] ? 1 : 0)),
      "each water with an open day highlights exactly one best day");
    assert(loaded.dailyRequests === 1, `waters on one NWS grid share one forecast request (${loaded.dailyRequests})`);
    assert(loaded.closedRows.length === loaded.expectedClosed, `typically closed days are marked, not scored (${loaded.closedRows.length} of ${loaded.expectedClosed})`);
    assert(loaded.closedRows.every((row) => /Typically snowed in - check ODOT TripCheck \/ USFS/.test(row) && /--/.test(row)),
      "a snowed-in day carries no score and points at TripCheck");
    assert(/season/.test(loaded.firstReason), `a scored day gives its one-line reason (${loaded.firstReason})`);
    assert(loaded.tripcheck === "https://www.tripcheck.com/", "the closure table links to ODOT TripCheck");
    assert(/NWS forecast saved/.test(loaded.status), `the panel says where the days came from (${loaded.status})`);
    assert(/not gauge readings/.test(loaded.disclaimer), "and that day scores are forecast and season, not gauges");

    const reopened = await page.evaluate(async () => {
      window.__dailyForecasts = 0;
      renderAll();
      return { rows: document.querySelectorAll("#today .planner-day").length, requests: window.__dailyForecasts };
    });
    assert(reopened.rows > 0 && reopened.requests === 0, "a loaded forecast is reused on the next render without a request");
    await page.close();
  }

  {
    const page = await openApp(browser, { before: dailyForecastFixture });
    const offline = await page.evaluate(async () => {
      document.querySelector("#today [data-plan-week]").click();
      await new Promise((done) => setTimeout(done, 50));
      await (plannerInFlight || Promise.resolve());
      await new Promise((done) => requestAnimationFrame(done));
      return {
        rows: document.querySelectorAll("#today .planner-day").length,
        status: document.querySelector("#today .planner-status")?.textContent || "",
        tone: document.querySelector("#today .planner-status")?.className || ""
      };
    });
    assert(offline.rows === 0, "with no network no day is shown");
    assert(/No forecast could be loaded/.test(offline.status) && /Nothing is shown in its place/.test(offline.status),
      `and the panel says so (${offline.status})`);
    assert(/error|offline/.test(offline.tone), "in the warning colour");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Alerts: opt-in per saved water, persisted, and posted to the container");

  {
    // The container answers every setRules and status with the permission;
    // here the angler allows notifications at the first prompt.
    const page = await openApp(browser, {
      before: `${dailyForecastFixture}
        window.__alerts = [];
        window.webkit = { messageHandlers: { riseAlerts: { postMessage: (message) => {
          window.__alerts.push(JSON.parse(JSON.stringify(message)));
          if (message.action !== "setRules" && message.action !== "status") return;
          const status = message.action === "setRules" && message.requestPermission ? "granted" : (window.__alertStatus || "notDetermined");
          window.__alertStatus = status;
          setTimeout(() => window.riseAlertsResult({ action: "permission", status }), 0);
        } } } };`
    });
    const startup = await page.evaluate(() => window.__alerts.slice());
    assert(startup.length === 1 && startup[0].action === "status",
      `a launch with no rules only asks for the permission status (${JSON.stringify(startup)})`);

    const unsaved = await page.evaluate(async () => {
      expandedWaterId = "lower-deschutes";
      saveActiveWater("lower-deschutes");
      renderAll();
      activateTab("waters");
      const editor = document.querySelector('#waters [data-alert-editor="lower-deschutes"]');
      return { text: editor?.textContent || "", toggles: editor?.querySelectorAll("[data-alert-toggle]").length ?? -1 };
    });
    assert(/Save this water/.test(unsaved.text) && unsaved.toggles === 0, "an unsaved water offers to save before it offers alerts");

    const flow = await page.evaluate(async () => {
      document.querySelector('#waters [data-alert-editor="lower-deschutes"] [data-save-water]').click();
      await new Promise((done) => requestAnimationFrame(done));
      window.__alerts.length = 0;
      const editor = () => document.querySelector('#waters [data-alert-editor="lower-deschutes"]');
      editor().querySelector("input[data-alert-field=flowMin]").click();
      const stillOpen = expandedWaterId === "lower-deschutes";
      editor().querySelector('[data-alert-toggle="flow"]').click();
      await new Promise((done) => requestAnimationFrame(done));
      const afterToggle = window.__alerts.slice();
      await new Promise((done) => setTimeout(done, 20));
      const min = editor().querySelector("input[data-alert-field=flowMin]");
      min.value = "3500";
      min.dispatchEvent(new Event("change", { bubbles: true }));
      const afterMin = window.__alerts[window.__alerts.length - 1];
      return {
        stillOpen,
        afterToggle,
        afterMin,
        pressed: editor().querySelector('[data-alert-toggle="flow"]').getAttribute("aria-pressed"),
        stored: JSON.parse(localStorage.getItem("riseAlertRules.v1") || "{}")
      };
    });
    assert(flow.stillOpen, "tapping a field inside the alert editor does not collapse the water card");
    assert(flow.pressed === "true", "the flow toggle shows it is on");
    const toggleMessage = flow.afterToggle[0];
    assert(toggleMessage?.action === "setRules" && toggleMessage.requestPermission === true,
      "turning an alert on posts the rules and asks for permission");
    const deschutes = toggleMessage?.rules?.find((rule) => rule.waterId === "lower-deschutes");
    assert(deschutes && deschutes.site === "14103000" && deschutes.waterName === "Lower Deschutes"
      && Number.isFinite(deschutes.flow?.min) && Number.isFinite(deschutes.flow?.max) && deschutes.greatDay === null,
      `the rule carries site id, water name, min and max (${JSON.stringify(deschutes)})`);
    assert(flow.afterMin?.action === "setRules" && flow.afterMin.requestPermission === false
      && flow.afterMin.rules.find((rule) => rule.waterId === "lower-deschutes")?.flow?.min === 3500,
      "editing the range re-posts it without asking for permission again");
    assert(flow.stored["lower-deschutes"]?.flow?.enabled === true && flow.stored["lower-deschutes"].flow.min === 3500,
      "the rule is persisted in localStorage");

    const ungauged = await page.evaluate(async () => {
      toggleSavedWater("hosmer");
      expandedWaterId = "hosmer";
      saveActiveWater("hosmer");
      renderAll();
      const editor = document.querySelector('#waters [data-alert-editor="hosmer"]');
      return { flowToggle: Boolean(editor?.querySelector('[data-alert-toggle="flow"]')), text: editor?.textContent || "" };
    });
    assert(!ungauged.flowToggle && /need a USGS gauge/.test(ungauged.text), "a water with no gauge offers no flow alert, and says why");

    const greatDay = await page.evaluate(async () => {
      window.__fetchPlan = { mode: "online", body: "" };
      toggleSavedWater("metolius");
      expandedWaterId = "metolius";
      saveActiveWater("metolius");
      renderAll();
      const editor = () => document.querySelector('#waters [data-alert-editor="metolius"]');
      const select = editor().querySelector("select[data-alert-field=threshold]");
      select.value = "6";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      window.__alerts.length = 0;
      editor().querySelector('[data-alert-toggle="greatDay"]').click();
      await new Promise((done) => setTimeout(done, 50));
      await (plannerInFlight || Promise.resolve());
      return window.__alerts.slice();
    });
    const setRules = greatDay.find((message) => message.action === "setRules");
    assert(setRules?.rules?.find((rule) => rule.waterId === "metolius")?.greatDay?.threshold === 6,
      "a great-day rule is posted with its threshold");
    const schedule = greatDay.find((message) => message.action === "scheduleGreatDays");
    const metolius = schedule?.waters?.find((entry) => entry.waterId === "metolius");
    assert(metolius && metolius.waterName === "Metolius" && metolius.threshold === 6 && Array.isArray(metolius.days),
      `turning it on loads the forecast and posts the schedule (${JSON.stringify(schedule)?.slice(0, 160)})`);
    assert(metolius?.days.length > 0 && metolius.days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && day.score >= 6 && day.reason && day.label),
      "each scheduled day has a date, a score at or above the threshold, and its reason");

    const permission = await page.evaluate(() => {
      window.riseAlertsResult({ action: "permission", status: "denied" });
      activateTab("waters");
      return document.querySelector('#waters [data-alert-editor="metolius"]')?.textContent || "";
    });
    assert(/Notifications are off for The Rise in iOS Settings/.test(permission), "a refused permission is said plainly");

    const overview = await page.evaluate(() => {
      activateTab("today");
      return [...document.querySelectorAll("#today .alerts-list li")].map((item) => item.textContent.replace(/\s+/g, " ").trim());
    });
    assert(overview.some((line) => /Lower Deschutes/.test(line) && /Flow 3,500/.test(line))
      && overview.some((line) => /Metolius/.test(line) && /Great day at 6\.0\+/.test(line)),
      `the planner lists each saved water's alerts (${overview.join(" | ")})`);

    const edit = await page.evaluate(async () => {
      document.querySelector('#today [data-edit-alerts="lower-deschutes"]').click();
      await new Promise((done) => requestAnimationFrame(done));
      const editor = document.querySelector('#waters [data-alert-editor="lower-deschutes"]');
      const rect = editor?.getBoundingClientRect();
      return { screen: activeScreenId(), visible: Boolean(rect) && rect.top >= 0 && rect.top < window.innerHeight };
    });
    assert(edit.screen === "waters" && edit.visible, "Set alerts opens that water's editor on screen");

    const unsave = await page.evaluate(() => {
      window.__alerts.length = 0;
      toggleSavedWater("lower-deschutes");
      const last = window.__alerts[window.__alerts.length - 1];
      return { last, stored: JSON.parse(localStorage.getItem("riseAlertRules.v1") || "{}") };
    });
    assert(unsave.last?.action === "setRules" && !unsave.last.rules.some((rule) => rule.waterId === "lower-deschutes")
      && !unsave.stored["lower-deschutes"], "unsaving a water withdraws its alert from storage and from the container");
    await page.close();
  }

  {
    const rules = { crooked: { flow: { enabled: true, min: 200, max: 300 }, greatDay: { enabled: false, threshold: 8 } } };
    const page = await openApp(browser, {
      before: `
        localStorage.setItem("riseSavedWaters.v1", JSON.stringify(["crooked"]));
        localStorage.setItem("riseAlertRules.v1", ${JSON.stringify(JSON.stringify(rules))});
        window.__alerts = [];
        window.webkit = { messageHandlers: { riseAlerts: { postMessage: (message) => window.__alerts.push(JSON.parse(JSON.stringify(message))) } } };`
    });
    const startup = await page.evaluate(() => window.__alerts.slice());
    assert(startup.length === 1 && startup[0].action === "setRules" && startup[0].requestPermission === false
      && startup[0].rules[0]?.waterId === "crooked" && startup[0].rules[0].flow.min === 200,
      "a launch with rules hands them to the container without a permission prompt");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Alerts: a container reply does not rebuild the editor under the angler's finger (A2, A5, A8)");

  {
    // This bridge REPLIES, as RiseViewController does, with whatever
    // window.__alertStatus says iOS currently reports.
    const page = await openApp(browser, {
      before: `
        localStorage.setItem("riseSavedWaters.v1", JSON.stringify(["lower-deschutes", "metolius"]));
        window.__alerts = [];
        window.__alertStatus = "notDetermined";
        window.webkit = { messageHandlers: { riseAlerts: { postMessage: (message) => {
          window.__alerts.push(JSON.parse(JSON.stringify(message)));
          if (message.action === "setRules" || message.action === "status") {
            setTimeout(() => window.riseAlertsResult({ action: "permission", status: window.__alertStatus }), 5);
          }
        } } } };`
    });

    const focusKept = await page.evaluate(async (wait) => {
      const settleIn = () => new Promise((done) => setTimeout(done, wait));
      expandedWaterId = "lower-deschutes";
      saveActiveWater("lower-deschutes");
      renderAll();
      activateTab("waters");
      const editor = () => document.querySelector('#waters [data-alert-editor="lower-deschutes"]');
      // A8: the toggle goes on over a range with no rule to send...
      const min = editor().querySelector("input[data-alert-field=flowMin]");
      min.value = "6000";
      min.dispatchEvent(new Event("change", { bubbles: true }));
      window.__alerts.length = 0;
      editor().querySelector('[data-alert-toggle="flow"]').click();
      await settleIn();
      const toggleMessage = window.__alerts.find((message) => message.action === "setRules");
      // ...so the edit that makes it valid is the one that asks.
      window.__alerts.length = 0;
      const field = editor().querySelector("input[data-alert-field=flowMax]");
      field.focus();
      field.value = "7000";
      field.dispatchEvent(new Event("change", { bubbles: true }));
      const fixMessage = window.__alerts.find((message) => message.action === "setRules");
      await settleIn();
      // A2: the reply said nothing new - the field is the same node and keeps focus.
      const sameNode = editor()?.querySelector("input[data-alert-field=flowMax]") === field;
      const focused = document.activeElement === field;
      // Now the angler allows notifications in Settings while typing.
      window.__alertStatus = "granted";
      field.value = "7100";
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await settleIn();
      return {
        toggleSent: toggleMessage?.rules?.some((rule) => rule.waterId === "lower-deschutes") ?? null,
        fixAsked: fixMessage?.requestPermission === true && fixMessage.rules.some((rule) => rule.waterId === "lower-deschutes"),
        sameNode,
        focused,
        stillSame: editor()?.querySelector("input[data-alert-field=flowMax]") === field && document.activeElement === field,
        status: editor()?.querySelector(".alert-editor-status")?.textContent || ""
      };
    }, 40);
    assert(focusKept.toggleSent === false, "a flow toggle over an invalid range sends no flow rule");
    assert(focusKept.fixAsked, "the edit that makes the range valid asks iOS for permission (A8)");
    assert(focusKept.sameNode && focusKept.focused, "an unchanged permission reply leaves the focused field in place (A2)");
    assert(focusKept.stillSame && /Notifications on/.test(focusKept.status),
      `a changed permission while a field has focus updates the status line in place (${focusKept.status})`);

    const todayStale = await page.evaluate(() => {
      activateTab("today");
      return [...document.querySelectorAll("#today .alerts-list li")].map((item) => item.textContent.replace(/\s+/g, " ").trim()).join(" | ");
    });
    assert(/Flow 6,000-7,100 cfs/.test(todayStale), `an edit saved without a repaint still shows on Today's alert list (${todayStale})`);

    // A5: hide a saved water with an alert, then follow Set alerts to it.
    const hidden = await page.evaluate(async (wait) => {
      window.__alerts.length = 0;
      toggleHiddenWater("lower-deschutes");
      renderAll();
      const lastRules = window.__alerts.filter((message) => message.action === "setRules").pop();
      activateTab("today");
      const line = [...document.querySelectorAll("#today .alerts-list li")].map((item) => item.textContent.replace(/\s+/g, " ").trim()).find((text) => /Lower Deschutes/.test(text)) || "";
      document.querySelector('#today [data-edit-alerts="lower-deschutes"]').click();
      await new Promise((done) => setTimeout(done, wait));
      const editor = document.querySelector('#waters [data-alert-editor="lower-deschutes"]');
      const rect = editor?.getBoundingClientRect();
      return {
        withdrawn: lastRules && !lastRules.rules.some((rule) => rule.waterId === "lower-deschutes"),
        kept: JSON.parse(localStorage.getItem("riseAlertRules.v1") || "{}")["lower-deschutes"]?.flow?.enabled === true,
        line,
        screen: activeScreenId(),
        visible: Boolean(rect) && rect.top >= 0 && rect.top < window.innerHeight,
        paused: editor?.textContent.includes("alerts are paused") || false
      };
    }, 40);
    assert(hidden.withdrawn && hidden.kept, "hiding the water withdraws its alert from the container but keeps the rule");
    assert(/\(hidden - alerts paused\)/.test(hidden.line), `the planner lists it as paused (${hidden.line})`);
    assert(hidden.screen === "waters" && hidden.visible && hidden.paused, "Set alerts on a hidden water opens its card, which says the alerts are paused");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Closures: a water snowed in today is labelled where its score is shown (D2, D10)");

  {
    const page = await openApp(browser, {
      before: `localStorage.setItem("riseSavedWaters.v1", JSON.stringify(["hosmer", "east-lake"]));`
    });
    const shown = await page.evaluate(() => {
      const realKey = pacificDateKey;
      window.pacificDateKey = (date) => (date ? realKey(date) : "2026-12-15");
      renderAll();
      activateTab("waters");
      const chip = [...document.querySelectorAll("#waters .water-chip-card")].find((card) => card.dataset.water === "east-lake");
      const card = document.querySelector('#waters [data-water="hosmer"].ranked-water-card');
      const top = watersSearchState().topWater;
      activateTab("today");
      const result = {
        chip: chip?.textContent.replace(/\s+/g, " ").trim() || "",
        card: card?.querySelector(".regs-flag")?.textContent || "",
        top: top?.id,
        best: document.querySelector('#today .command-card.primary[data-go="waters"] strong')?.textContent || ""
      };
      window.pacificDateKey = realKey;
      return result;
    });
    assert(/Typically snowed in/.test(shown.chip), `the saved East Lake chip says it is snowed in in December (${shown.chip})`);
    assert(/Typically snowed in/.test(shown.card), `Hosmer's rank card carries the flag (${shown.card})`);
    assert(!["east-lake", "hosmer", "paulina"].includes(shown.top) && shown.best && !/East Lake|Hosmer/.test(shown.best),
      `December's top pick is a water that can be reached (${shown.top}, ${shown.best})`);
    await page.close();
  }

  group("Feature 5: Snap a bug - photo in, sampled colour out, results escaped");

  {
    // A 3x phone, so a tap mapped in screen pixels instead of by fraction of
    // the displayed photo would land in the wrong half of the picture.
    const page = await openApp(browser, { viewport: { width: 390, height: 844, deviceScaleFactor: 3 } });
    const feedPhoto = (kind) => page.evaluate(async (kind) => {
      proAccessActive = true;
      renderAll();
      activateTab("bugs");
      let file;
      if (kind === "broken") {
        file = new File(["not an image"], "bug.jpg", { type: "image/jpeg" });
      } else {
        // Left half olive, right half red: two colours nobody disputes.
        const canvas = document.createElement("canvas");
        canvas.width = 400;
        canvas.height = 200;
        const context = canvas.getContext("2d");
        context.fillStyle = "rgb(100, 120, 40)";
        context.fillRect(0, 0, 200, 200);
        context.fillStyle = "rgb(180, 30, 30)";
        context.fillRect(200, 0, 200, 200);
        const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
        file = new File([blob], "bug.png", { type: "image/png" });
      }
      // The real change path: a file on the rendered input, and a bubbling
      // change event for the delegated handler to pick up.
      const input = document.querySelector("#bugs [data-snap-photo]");
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      for (let i = 0; i < 100 && snapBug.status === "loading"; i += 1) {
        await new Promise((done) => setTimeout(done, 30));
      }
      return {
        status: snapBug.status,
        photo: document.querySelector("#bugs .snap-photo")?.getAttribute("src") || "",
        data: snapBug.photo.slice(0, 22),
        error: document.querySelector("#bugs .snap-error")?.textContent || "",
        stored: Object.keys(localStorage).filter((key) => /data:image/.test(localStorage.getItem(key) || ""))
      };
    }, kind);

    const broken = await feedPhoto("broken");
    assert(broken.status === "error" && /could not be opened/.test(broken.error), `an undecodable photo says so (${broken.error})`);

    const loaded = await feedPhoto("good");
    assert(loaded.status === "ready" && loaded.data.startsWith("data:image/jpeg") && loaded.photo.startsWith("blob:"),
      `a picked photo goes through the catch-photo decoder and is shown from one blob: URL, not inlined (${loaded.photo.slice(0, 22)})`);
    assert(!loaded.stored.length, `and nothing is written to storage (${loaded.stored.join(", ") || "nothing"})`);

    const tap = async (fraction) => {
      const box = await page.evaluate(() => {
        const image = document.querySelector("#bugs .snap-photo");
        image.scrollIntoView({ block: "center" });
        const rect = image.getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      });
      await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
      return page.evaluate(() => ({
        trait: snapTraits.color,
        select: document.querySelector('#bugs [data-snap-trait="color"]')?.value,
        hex: snapBug.sample?.hex,
        swatch: getComputedStyle(document.querySelector("#bugs .snap-swatch")).backgroundColor,
        marker: Boolean(document.querySelector("#bugs .snap-marker")),
        status: document.querySelector("#bugs [data-snap-sample-status]")?.textContent || "",
        displayed: document.querySelector("#bugs .snap-photo").getBoundingClientRect().width,
        natural: snapSampleCanvas?.width
      }));
    };
    const olive = await tap(.25);
    assert(olive.trait === "olive" && olive.select === "olive",
      `a real tap on the left of the photo samples olive (${olive.trait}, ${olive.hex}, select ${olive.select})`);
    assert(olive.displayed !== olive.natural, `the photo is drawn scaled, so the tap is mapped, not copied (${Math.round(olive.displayed)}pt shown, ${olive.natural}px sampled)`);
    assert(olive.marker && /Olive/.test(olive.status) && olive.swatch !== "rgba(0, 0, 0, 0)",
      `the swatch and tap marker show what was sampled (${olive.swatch})`);
    const red = await tap(.75);
    assert(red.trait === "red", `a tap on the right samples red (${red.trait}, ${red.hex})`);

    const override = await page.evaluate(() => {
      const select = document.querySelector('#bugs [data-snap-trait="color"]');
      select.value = "tan";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { trait: snapTraits.color, status: document.querySelector("#bugs [data-snap-sample-status]").textContent };
    });
    assert(override.trait === "tan" && /You changed it to Tan/.test(override.status),
      `the angler can overrule the sample (${override.status.trim().slice(0, 80)})`);

    const results = await page.evaluate(() => {
      const select = document.querySelector('#bugs [data-snap-trait="color"]');
      select.value = "olive";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      for (const [key, value] of [["size", "s20"], ["shape", "upright"], ["tails", "2"]]) {
        document.querySelector(`#bugs [data-snap-choice="${key}"][data-snap-value="${value}"]`).click();
      }
      const cards = [...document.querySelectorAll("#bugs .snap-result")];
      const markup = document.querySelector("#bugs").innerHTML;
      return {
        names: cards.map((card) => card.querySelector("strong").textContent),
        first: cards[0]?.textContent.replace(/\s+/g, " ") || "",
        photos: cards.filter((card) => card.querySelector(".snap-compare img")?.getAttribute("src") === snapBug.photoUrl).length,
        markupBytes: markup.length,
        inlined: markup.includes("data:image"),
        urlCopies: markup.split(snapBug.photoUrl).length - 1,
        plates: cards.filter((card) => /bug-plates\//.test(card.querySelector(".snap-plate")?.getAttribute("style") || "")).length,
        flies: cards.every((card) => card.querySelector("[data-snap-fly]") && card.querySelector("[data-hatch-pick]")),
        pressed: document.querySelector('#bugs [data-snap-choice="size"][data-snap-value="s20"]').getAttribute("aria-pressed")
      };
    });
    assert(results.names[0] === "Blue-Winged Olive" && results.names.length <= 3,
      `olive, #20, upright wings, two tails is a BWO first (${results.names.join(", ")})`);
    assert(/Strong match on 4 of 4 traits/.test(results.first) && /Matched size: #20/.test(results.first),
      "with its confidence and the traits it matched");
    assert(/In season in|Edge of its season|Out of season/.test(results.first), "and the season prior explained");
    assert(results.photos === results.names.length && results.plates === results.names.length,
      "every result shows the angler's photo beside the bug plate");
    assert(results.flies, "and links to its flies and to the bug");
    assert(!results.inlined && results.urlCopies === results.names.length + 1,
      `a trait tap repaints Bugs with the one blob: URL, never the photo's data inlined (${results.urlCopies} references, ${Math.round(results.markupBytes / 1024)} KB of markup)`);
    assert(results.pressed === "true", "a chosen answer is marked pressed");

    const opened = await page.evaluate(async () => {
      document.querySelector("#bugs .snap-result [data-snap-fly]").click();
      await new Promise((done) => requestAnimationFrame(done));
      const library = document.querySelector("#bugs .bug-card.active .fly-library");
      const rect = library?.getBoundingClientRect();
      return { bug: activeBug, fly: activeFlyName, onScreen: Boolean(rect) && rect.top < innerHeight && rect.bottom > 0 };
    });
    assert(opened.bug === "bwo" && opened.fly && opened.onScreen,
      `a matching fly opens that bug's imitation library on screen (${opened.bug}, ${opened.fly})`);

    const nothing = await page.evaluate(() => {
      snapTraits = { color: "blue", size: "", shape: "fish", tails: "2" };
      renderBugs();
      return {
        cards: document.querySelectorAll("#bugs .snap-result").length,
        text: document.querySelector("#bugs .snap-empty")?.textContent || ""
      };
    });
    assert(!nothing.cards && /Nothing in the bug library matches/.test(nothing.text), "traits nothing matches show no result, and say so");

    const escaped = await page.evaluate(() => {
      const bug = bugs.find((item) => item.id === "bwo");
      const fly = flyLibrary.find((item) => item.bugId === "bwo");
      const saved = [bug.name, fly.name];
      bug.name = `BWO <img src=x data-pwned onerror="window.__pwned=1"> "quoted"`;
      fly.name = `RS2 <b data-pwned>bold</b> "#20"`;
      snapTraits = { color: "olive", size: "s20", shape: "upright", tails: "2" };
      renderBugs();
      const panel = document.querySelector("#bugs .snap-bug");
      const result = {
        injected: panel.querySelectorAll("[data-pwned]").length,
        text: panel.textContent.includes("<img src=x data-pwned") && panel.textContent.includes("<b data-pwned>bold</b>"),
        flyValue: panel.querySelector("[data-snap-fly]")?.dataset.snapFly
      };
      [bug.name, fly.name] = saved;
      renderBugs();
      return { ...result, ran: Boolean(window.__pwned) };
    });
    assert(!escaped.injected && !escaped.ran && escaped.text, "bug and fly names in the results are escaped, not parsed");
    assert(escaped.flyValue === `RS2 <b data-pwned>bold</b> "#20"`, `and a fly name survives an attribute intact (${escaped.flyValue})`);

    const attached = await page.evaluate(async () => {
      document.querySelector("#bugs [data-snap-attach]").click();
      const form = document.querySelector("#logForm");
      const visible = document.querySelector(".view.active")?.id;
      const preview = form?.querySelector("[data-log-attached-photo] img")?.getAttribute("src") || "";
      await saveLogEntry(form);
      const entry = getLogs()[0];
      return { visible, preview: preview === snapBug.photo, photo: entry?.photo?.slice(0, 22) || "", pending: pendingCatchPhoto, count: getLogs().length };
    });
    assert(attached.visible === "log" && attached.preview, "Attach opens the catch form with the bug photo shown in it");
    assert(attached.count === 1 && attached.photo.startsWith("data:image/jpeg") && !attached.pending,
      `saving stores it through the catch-photo path and releases it (${attached.photo})`);

    const kept = await page.evaluate(() => {
      activateTab("log");
      document.querySelector("[data-new-log]").click();
      const form = document.querySelector("#logForm");
      form.elements.notes.value = "draft in progress";
      activateTab("bugs");
      document.querySelector("#bugs [data-snap-attach]").click();
      const now = document.querySelector("#logForm");
      const shown = Boolean(now.querySelector("[data-log-attached-photo] img"));
      now.querySelector("[data-detach-photo]").click();
      return {
        sameForm: now === form && now.elements.notes.value === "draft in progress",
        shown,
        removed: !pendingCatchPhoto && document.querySelector("[data-log-attached-photo]").hidden
      };
    });
    assert(kept.sameForm && kept.shown, "attaching to an open form keeps the angler's draft and adds the photo");
    assert(kept.removed, "and Remove takes it off again");

    const cleared = await page.evaluate(() => {
      window.__revoked = [];
      const realRevoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => { window.__revoked.push(url); realRevoke(url); };
      activateTab("bugs");
      const url = snapBug.photoUrl;
      document.querySelector("#bugs [data-snap-clear]").click();
      return { status: snapBug.status, photo: Boolean(document.querySelector("#bugs .snap-photo")), canvas: snapSampleCanvas, revoked: window.__revoked.includes(url) };
    });
    assert(cleared.status === "idle" && !cleared.photo && !cleared.canvas, "Clear drops the photo and its pixels");
    assert(cleared.revoked, "and revokes its blob: URL");
    await feedPhoto("good");
    const firstUrl = await page.evaluate(() => snapBug.photoUrl);
    await feedPhoto("good");
    const replaced = await page.evaluate((url) => ({ revoked: window.__revoked.includes(url), now: snapBug.photoUrl }), firstUrl);
    assert(replaced.revoked && replaced.now.startsWith("blob:") && replaced.now !== firstUrl, "a replacement photo revokes the old URL and makes one new one");
    await page.close();
  }

  {
    const page = await openApp(browser);
    const restored = await page.evaluate(() => {
      window.riseAlertsRestore({ rules: [{ waterId: "crooked", waterName: "Crooked River", site: "14080500", flow: { min: 200, max: 300 }, greatDay: null }, { waterId: "../bad" }] });
      return {
        rules: JSON.parse(localStorage.getItem("riseAlertRules.v1") || "{}"),
        saved: JSON.parse(localStorage.getItem("riseSavedWaters.v1") || "[]")
      };
    });
    assert(restored.rules.crooked?.flow?.enabled === true && !restored.rules["../bad"] && restored.saved.includes("crooked"),
      "rules the container kept come back after the page's storage was cleared");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Plan the week and alerts fit the phone and meet the 44pt minimum");

  for (const width of [320, 390]) {
    const page = await openApp(browser, { before: dailyForecastFixture, viewport: { width, height: 844 } });
    const result = await page.evaluate(async () => {
      window.__fetchPlan = { mode: "online", body: "" };
      toggleSavedWater("crooked");
      toggleSavedWater("hosmer");
      toggleAlert("crooked", "flow");
      toggleAlert("hosmer", "greatDay");
      await loadPlannerForecasts();
      document.querySelectorAll("#today details").forEach((details) => { details.open = true; });
      const small = [];
      const measure = (root) => root?.querySelectorAll("button, a[href], select, input, summary").forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        if (rect.width < 44 || rect.height < 44) small.push(`${element.className || element.tagName} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      });
      measure(document.querySelector("#today .planner"));
      const overflowToday = document.documentElement.scrollWidth - window.innerWidth;
      expandedWaterId = "crooked";
      saveActiveWater("crooked");
      renderAll();
      activateTab("waters");
      measure(document.querySelector('#waters [data-alert-editor="crooked"]'));
      return {
        small,
        rows: document.querySelectorAll("#today .planner-day").length,
        overflowToday,
        overflowWaters: document.documentElement.scrollWidth - window.innerWidth
      };
    });
    assert(result.rows > 0, `${width}pt: the loaded planner is measured (${result.rows} day rows)`);
    assert(!result.small.length, `${width}pt: every planner and alert control is at least 44pt (${result.small.slice(0, 3).join(", ") || "none"})`);
    assert(result.overflowToday <= 0 && result.overflowWaters <= 0,
      `${width}pt: nothing runs off the right edge (${result.overflowToday}px, ${result.overflowWaters}px)`);
    await page.close();
  }


  {
    const page = await openApp(browser);
    const locked = await page.evaluate(() => {
      proAccessActive = false;
      renderAll();
      activateTab("bugs");
      const panel = document.querySelector("#bugs .snap-bug");
      return {
        lock: Boolean(panel?.querySelector(".pro-lock [data-tab-jump=\"pro\"]")),
        input: document.querySelectorAll("#bugs [data-snap-photo]").length,
        text: panel?.textContent || ""
      };
    });
    assert(locked.lock && !locked.input, "a free user sees the Pro lock and no camera input");
    assert(/does not recognise bugs from photos/.test(locked.text), "and the lock does not oversell what Pro does with a photo");
    await page.close();
  }

  group("Your water: the profile card says what it knows and what it does not");

  {
    const crookedCatch = (overrides) => sampleEntry({
      waterId: "crooked",
      waterName: "Crooked River",
      flowSource: "measured",
      tempSource: "measured",
      ...overrides
    });
    const cardText = async (page) => page.evaluate(() => {
      saveActiveWater("crooked");
      renderAll();
      activateTab("trip");
      const card = document.querySelector("#trip .your-water-card");
      return { text: card ? card.textContent.replace(/\s+/g, " ") : "", images: card ? card.querySelectorAll("img").length : -1 };
    });

    const page = await openApp(browser);
    await seedLogs(page, [crookedCatch({ flow: "230 cfs" }), crookedCatch({ flow: "250 cfs" })]);
    const two = await cardText(page);
    assert(/Your Crooked River/.test(two.text), `the card is named for the water (${two.text.slice(0, 60)})`);
    assert(/Need 3\+ catches here to build your profile - you have 2\./.test(two.text),
      `two catches say how many more are needed (${two.text})`);
    assert(!/cfs/.test(two.text), "and state no flow band");

    await seedLogs(page, [
      crookedCatch({ flow: "230 cfs" }),
      crookedCatch({ flow: "250 cfs" }),
      crookedCatch({ flow: "4,160 cfs", flowSource: "reference" }),
      crookedCatch({ fly: '<img src=x onerror="window.__owned=1">', count: "3" })
    ]);
    const thin = await cardText(page);
    assert(/From your 4 catches/.test(thin.text), `four catches are a profile (${thin.text.slice(0, 80)})`);
    assert(/230-250 cfs/.test(thin.text) && /from 3 measured readings/.test(thin.text),
      `the band is the three measured flows (${thin.text})`);
    assert(!/4,160/.test(thin.text), "a reference flow never appears in the angler's band");
    assert(thin.images === 0 && /<img src=x/.test(thin.text), "a fly name with markup is shown as text, not parsed");

    await seedLogs(page, [
      crookedCatch({ flow: "230 cfs" }),
      crookedCatch({ flow: "250 cfs" }),
      crookedCatch({ flow: "4,160 cfs", flowSource: "reference" }),
      crookedCatch({ flow: "4,160 cfs", flowSource: "reference" })
    ]);
    const unmeasured = await cardText(page);
    assert(/need 3\+ catches with a measured flow \(you have 2\)/.test(unmeasured.text),
      `too few measured flows says exactly that (${unmeasured.text})`);

    await seedLogs(page, [
      crookedCatch({ flow: "230 cfs", time: "6:10 PM" }),
      crookedCatch({ flow: "250 cfs", time: "7:20 PM" }),
      crookedCatch({ flow: "240 cfs", time: "6:45 PM" })
    ]);
    const full = await cardText(page);
    assert(/From your 3 catches/.test(full.text) && /230-250 cfs/.test(full.text) && /from 3 measured readings/.test(full.text),
      `three measured catches state a band and its sample (${full.text})`);
    assert(/6 PM-8 PM|6 PM-9 PM/.test(full.text), `and a best time (${full.text})`);
    const memoryCards = await page.evaluate(() => document.querySelectorAll("#trip .memory-card").length);
    assert(memoryCards === 1, `the old memory card is folded in, not duplicated (${memoryCards})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("ODFW regulations: the block on the water card, Trip and On the water");

  {
    const page = await openApp(browser);
    const result = await page.evaluate(() => {
      const allowed = (href) => {
        try {
          const url = new URL(href);
          return url.protocol === "https:" && /(^|\.)(myodfw\.com|eregulations\.com)$/.test(url.hostname);
        } catch {
          return false;
        }
      };
      const linksOf = (block) => [...block.querySelectorAll("a")].map((link) => ({
        href: link.href, target: link.target, rel: link.rel, text: link.textContent.trim(), allowed: allowed(link.href)
      }));
      // Text that would be markup if it reached innerHTML unescaped.
      const hostile = `<img src=x onerror="window.__regsInjected = true">Barbless <b>only</b>`;
      ODFW_REGULATIONS.metolius.summary = [...ODFW_REGULATIONS.metolius.summary, hostile];
      ODFW_REGULATIONS["bridge-creek"].uncertain = `${ODFW_REGULATIONS["bridge-creek"].uncertain} <script>window.__regsInjected = true</script>`;

      // Waters: tap the card open, the way an angler does.
      activateTab("waters");
      waterSortMode = "Best";
      renderWaters();
      document.querySelector('#waters .waters-main-list [data-water="metolius"]').click();
      const card = document.querySelector('#waters .waters-main-list [data-water="metolius"]');
      const block = card?.querySelector(".accordion-detail .regs-block");
      const cardOut = block ? {
        checked: block.querySelector(".regs-checked")?.textContent.trim(),
        disclaimer: block.querySelector(".regs-disclaimer")?.textContent.trim(),
        items: [...block.querySelectorAll(".regs-list li")].map((item) => item.textContent),
        injectedNodes: block.querySelectorAll("img, script, .regs-list li *").length,
        links: linksOf(block),
        oldLine: [...card.querySelectorAll(".line-row span")].some((span) => span.textContent.trim() === "Regulations")
      } : null;
      // A tap on the block's text does not collapse the card around it.
      block?.querySelector(".regs-list li")?.click();
      const stillOpen = Boolean(document.querySelector('#waters .waters-main-list [data-water="metolius"] .accordion-detail .regs-block'));

      // Verify note on an unconfirmed water.
      expandedWaterId = "bridge-creek";
      saveActiveWater("bridge-creek");
      renderWaters();
      const verifyBlock = document.querySelector('#waters .waters-main-list [data-water="bridge-creek"] .regs-block');
      const verify = verifyBlock ? {
        note: verifyBlock.querySelector(".regs-verify")?.textContent.trim(),
        status: verifyBlock.querySelector(".regs-status")?.textContent.trim(),
        scripts: verifyBlock.querySelectorAll("script").length
      } : null;

      // Trip.
      saveActiveWater("crooked");
      activateTab("trip");
      renderTrip();
      const tripBlock = document.querySelector("#trip .regs-block");
      const trip = tripBlock ? {
        checked: tripBlock.querySelector(".regs-checked")?.textContent.trim(),
        disclaimer: tripBlock.querySelector(".regs-disclaimer")?.textContent.trim(),
        status: tripBlock.querySelector(".regs-status")?.textContent.trim(),
        links: linksOf(tripBlock)
      } : null;

      // On the water: compact, season status and gear.
      saveActiveWater("whychus");
      renderTrip();
      document.querySelector("#trip [data-on-water-open]").click();
      const compact = document.querySelector("#trip [data-on-water-view] .regs-compact");
      const onWater = compact ? {
        status: compact.querySelector(".regs-status")?.textContent.trim(),
        gear: compact.querySelector("small")?.textContent.trim(),
        checked: compact.querySelector(".regs-checked")?.textContent.trim() || "",
        disclaimer: compact.querySelector(".regs-disclaimer")?.textContent.trim() || "",
        links: linksOf(compact),
        linkHeights: [...compact.querySelectorAll("a")].map((link) => Math.round(link.getBoundingClientRect().height)),
        closedToday: regulationSeasonStatus(waterById("whychus")) === "closed"
      } : null;
      document.querySelector("#trip [data-on-water-close]").click();
      return { cardOut, stillOpen, verify, trip, onWater, injected: Boolean(window.__regsInjected) };
    });

    const goodLinks = (links) => links.length >= 2 && links.every((link) => link.allowed && link.target === "_blank" && /noopener/.test(link.rel));
    assert(result.cardOut, "the expanded water card has a Regulations block");
    assert(result.cardOut && result.cardOut.checked.startsWith("2026 ODFW regulations - checked Nov 18, 2026"), `it says which booklet and when it was checked (${result.cardOut?.checked})`);
    assert(result.cardOut && /^Summary only\. Regulations change and in-season rules apply - check ODFW before you fish\.$/.test(result.cardOut.disclaimer), "and that it is a summary, not the law");
    assert(result.cardOut && result.cardOut.items.some((item) => /Catch-and-release for trout, including bull trout/.test(item)), "the Metolius bullets are the ODFW summary");
    assert(result.cardOut && result.cardOut.items.some((item) => item.includes('<img src=x onerror="window.__regsInjected = true">Barbless <b>only</b>')), "regulation text is escaped: markup shows as text");
    assert(result.cardOut && result.cardOut.injectedNodes === 0 && !result.injected, `and creates no element and runs nothing (${result.cardOut?.injectedNodes})`);
    assert(result.cardOut && goodLinks(result.cardOut.links), `its links go to ODFW or eRegulations and open outside the app (${JSON.stringify(result.cardOut?.links.map((link) => link.href))})`);
    assert(result.cardOut && result.cardOut.links.some((link) => /myodfw\.com\/articles\/regulation-updates/.test(link.href)), "one of them is ODFW's in-season changes page");
    assert(result.cardOut && !result.cardOut.oldLine, "the old generic Regulations line is gone");
    assert(result.stillOpen, "tapping the block's text leaves the card open");
    assert(result.verify && /^Verify with ODFW:/.test(result.verify.note) && result.verify.status === "Season not confirmed - check ODFW",
      `an unconfirmed water says to verify, and why (${result.verify?.note?.slice(0, 60)})`);
    assert(result.verify && result.verify.scripts === 0, "and its note is escaped too");
    assert(result.trip && result.trip.checked.startsWith("2026 ODFW regulations - checked Nov 18, 2026") && /Summary only/.test(result.trip.disclaimer), "Trip shows the Regulations block");
    assert(result.trip && goodLinks(result.trip.links), "with links that open outside the app");
    assert(result.onWater, "On the water shows the compact Regulations block");
    assert(result.onWater && /Artificial flies and lures only/.test(result.onWater.gear), `with the gear rule (${result.onWater?.gear})`);
    assert(result.onWater && result.onWater.status === (result.onWater.closedToday ? "Closed season (ODFW)" : "Open season (ODFW)"), `and today's season status (${result.onWater?.status})`);
    // Short on the water: the dated detail is on Trip, one tap away.
    assert(result.onWater && /^Summary only\./.test(result.onWater.disclaimer) && !result.onWater.checked && goodLinks(result.onWater.links), "and that it is a summary, with the ODFW links");
    assert(result.onWater && result.onWater.linkHeights.every((height) => height >= 44), `its links are at least 44pt tall (${result.onWater?.linkHeights.join(", ")})`);
    await page.close();
  }

  {
    // A closed season, stubbed to today whatever today is: the water with the
    // best conditions in the app is closed, and must not be the top pick.
    const page = await openApp(browser);
    const result = await page.evaluate(() => {
      const today = pacificDateKey().slice(5);
      const other = today === "01-01" ? "01-02" : "01-01";
      ODFW_REGULATIONS.crooked = { ...ODFW_REGULATIONS.crooked, season: { from: other, to: other } };
      waters.find((water) => water.id === "crooked").score = 100;
      waterSortMode = "Best";
      waterFilter = "All";
      waterQuery = "";
      activateTab("today");
      renderEverything();
      const bestOption = [...document.querySelectorAll("#today .command-card")].find((card) => /Best option now/.test(card.textContent));
      const cards = [...document.querySelectorAll("#waters .waters-main-list [data-water]")];
      const order = cards.map((card) => card.dataset.water);
      const crookedCard = cards.find((card) => card.dataset.water === "crooked");
      const closedIndex = order.indexOf("crooked");
      const openAfter = order.slice(closedIndex + 1).filter((id) => regulationSeasonStatus(waterById(id)) !== "closed");
      return {
        top: topRecommendedWater().id,
        bestOption: bestOption?.querySelector("strong")?.textContent.trim(),
        headline: document.querySelector("#watersHeadline h1")?.textContent.trim(),
        label: crookedCard?.querySelector(".water-rank-label")?.textContent.trim(),
        openAfter,
        status: regulationSeasonStatus(waterById("crooked"))
      };
    });
    assert(result.status === "closed", "the stubbed season closes the Crooked River today");
    assert(result.top !== "crooked" && result.bestOption !== "Crooked River", `a closed water is not Today's top pick (${result.bestOption})`);
    assert(result.headline !== "Crooked River", `nor the top of the Waters list (${result.headline})`);
    assert(/Closed season \(ODFW\)/.test(result.label || ""), `its card is labelled (${result.label})`);
    assert(!result.openAfter.length, `and no open water ranks below it (${result.openAfter.slice(0, 3).join(", ") || "none"})`);
    await page.close();
  }

  {
    // The March 1 check reads ODFW's page once and warns when a newer booklet
    // is named. Launch is on or after Mar 1 of the year the suite runs in, so
    // the check runs at startup; the page is served from the start.
    const before = `window.__fetchPlan = { mode: "online", body: "<h1>Fishing regulation updates</h1><p>Changes to the 2026 Oregon Sport Fishing Regulations.</p><p>The 2027 Oregon Sport Fishing Regulations are now available.</p>" };`;
    const page = await openApp(browser, { before });
    const result = await page.evaluate(async () => {
      const today = regulationDateParts(pacificDateKey());
      if (today.month < 3) {
        // Before March the check is not due; run it as March would.
        await runRegulationsAnnualCheck({ dateKey: `${today.year}-03-01` });
      }
      for (let tries = 0; tries < 50 && !readRegulationsCheck().ok; tries += 1) {
        await new Promise((done) => setTimeout(done, 50));
      }
      saveActiveWater("crooked");
      activateTab("trip");
      renderTrip();
      const block = document.querySelector("#trip .regs-block");
      return {
        record: readRegulationsCheck(),
        checks: window.__requests.filter((url) => url === REGS_CHECK_URL).length,
        warning: block?.querySelector(".regs-stale")?.textContent.trim(),
        status: block?.querySelector(".regs-status")?.textContent.trim(),
        line: block?.querySelector(".regs-check-line")?.textContent.trim(),
        link: [...(block?.querySelectorAll("a") || [])].some((link) => /myodfw\.com/.test(link.href))
      };
    });
    assert(result.record.ok && result.record.publishedYear === 2027, `the check stored the newest booklet the page names (${JSON.stringify(result.record)})`);
    assert(result.checks === 1, `with one request to ODFW (${result.checks})`);
    assert(result.warning === "Verify with ODFW: ODFW has published 2027 regulations. This summary is from 2026 and may be out of date - check ODFW before you fish.",
      `the Regulations block warns that the summary may be out of date (${result.warning})`);
    assert(/\(2026 rules\)$/.test(result.status || ""), `the season label names the bundled year (${result.status})`);
    assert(/^Checked for new ODFW regulations /.test(result.line || "") && result.link, `and says when it checked, with the ODFW link (${result.line})`);
    await page.close();
  }

  {
    const page = await openApp(browser);
    const result = await page.evaluate(async () => {
      for (let tries = 0; tries < 50 && regulationsCheckInFlight; tries += 1) {
        await new Promise((done) => setTimeout(done, 50));
      }
      saveActiveWater("crooked");
      activateTab("trip");
      renderTrip();
      const block = document.querySelector("#trip .regs-block");
      return {
        record: readRegulationsCheck(),
        month: regulationDateParts(pacificDateKey()).month,
        calendar: regulationsStaleness()?.kind === "calendar",
        stale: block?.querySelectorAll(".regs-stale").length,
        text: block?.textContent || "",
        line: block?.querySelector(".regs-check-line")?.textContent.trim()
      };
    });
    if (result.month >= 3) {
      assert(!result.record.ok && result.record.attemptedOn, `offline, the check is recorded as attempted, not done (${JSON.stringify(result.record)})`);
      assert(result.line === "Couldn't check for new ODFW regulations yet - will retry", `and the block says it will retry (${result.line})`);
    }
    assert(!/ODFW has published/.test(result.text), "an offline launch claims no new booklet");
    assert(result.stale === (result.calendar ? 1 : 0), `and shows no warning beyond the calendar's own (${result.stale})`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("On the water: Fish on! writes one catch, with its provenance, through setLogs");

  // A measured reading for the Crooked River, so provenance is "measured".
  const measuredCrooked = () => {
    saveActiveWater("crooked");
    liveReports.byWater.crooked = {
      status: "ready",
      cachedAt: new Date().toISOString(),
      usgs: { flow: "240 cfs", waterTemp: "53 F" },
      nws: { forecast: "Sunny", wind: "5 mph", air: "70 F" },
      errors: []
    };
    renderAll();
    activateTab("trip");
    document.querySelector("[data-on-water-open]").click();
  };

  {
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ notes: "A" }), sampleEntry({ notes: "B" })]);
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      const view = Boolean(document.querySelector("#trip [data-on-water-view]"));
      const shownFly = document.querySelector("#trip [data-on-water-fly]").textContent.trim();
      const before = getLogs().length;
      document.querySelector("#trip [data-fish-on]").click();
      await new Promise((done) => requestAnimationFrame(done));
      const entry = getLogs()[0];
      const stored = JSON.parse(localStorage.getItem("riseLogs"));
      activateTab("log");
      const firstCard = document.querySelector("#log .catch-card");
      const firstCardIndex = firstCard?.querySelector("[data-edit-log]")?.dataset.editLog;
      activateTab("trip");
      return {
        view, shownFly, before, after: getLogs().length, storedCount: stored.length,
        entry, expectedDate: zonedDateLabel(), expectedTime: zonedTimeLabel(),
        ageMs: Date.now() - Date.parse(entry.loggedAt),
        firstCardText: firstCard?.textContent || "", firstCardIndex,
        confirmation: document.querySelector("#trip .on-water-logged")?.textContent.replace(/\s+/g, " ") || "",
        feedback: flyFeedback[shownFly]
      };
    }, measuredCrooked.toString());
    assert(result.view, "the Trip screen opens into On the water");
    assert(result.before === 2 && result.after === 3 && result.storedCount === 3, `one tap writes exactly one catch (${result.before} -> ${result.after})`);
    const entry = result.entry;
    assert(entry.waterId === "crooked" && entry.waterName === "Crooked River", "on the current water");
    assert(entry.fly === result.shownFly, `with the fly on screen (${entry.fly})`);
    assert(entry.flow === "240 cfs" && entry.flowSource === "measured", `and the measured flow with its provenance (${entry.flow}, ${entry.flowSource})`);
    assert(entry.temp === "53 F" && entry.tempSource === "measured", `and the measured temperature with its provenance (${entry.temp}, ${entry.tempSource})`);
    assert(entry.date === result.expectedDate && entry.time === result.expectedTime, `filed on Oregon's date and time (${entry.date} ${entry.time})`);
    assert(result.ageMs >= 0 && result.ageMs < 10000, "stamped with a full timestamp of the moment");
    assert(entry.fish === "" && entry.length === "" && entry.count === "1", "nothing the angler did not enter is invented");
    assert(result.firstCardIndex === "0" && result.firstCardText.includes(entry.fly),
      `and it is journal index 0, the first card, with Edit pointing at 0 (${result.firstCardIndex})`);
    assert(/Undo/.test(result.confirmation) && /Add details/.test(result.confirmation) && /240 cfs \(measured\)/.test(result.confirmation),
      `the confirmation offers Undo and Add details and shows the reading (${result.confirmation})`);
    assert(result.feedback === "worked", "the fly is marked as worked, as a saved catch always is");

    const details = await page.evaluate(async () => {
      document.querySelector("#trip [data-fish-on-details]").click();
      await new Promise((done) => requestAnimationFrame(done));
      return {
        tab: document.querySelector(".view.active").id,
        editing: editingLogIndex,
        heading: document.querySelector("#logForm h2")?.textContent || "",
        fly: document.querySelector("#logForm [name=fly]")?.value,
        same: getLogs()[editingLogIndex] === getLogs()[0]
      };
    });
    assert(details.tab === "log" && details.editing === 0 && details.same && /Edit Catch/.test(details.heading) && details.fly === entry.fly,
      `Add details opens the ordinary edit form on that catch (${details.tab}, index ${details.editing}, ${details.heading})`);
    await page.close();
  }

  {
    // Double tap: the second tap lands on the re-rendered button.
    const page = await openApp(browser);
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      document.querySelector("#trip [data-fish-on]").click();
      document.querySelector("#trip [data-fish-on]").click();
      await new Promise((done) => setTimeout(done, 50));
      document.querySelector("#trip [data-fish-on]").click();
      return { count: getLogs().length, stored: JSON.parse(localStorage.getItem("riseLogs")).length };
    }, measuredCrooked.toString());
    assert(result.count === 1 && result.stored === 1, `a double-tap (and a third tap) on Fish on! writes one catch (${result.count})`);
    await page.close();
  }

  {
    // Undo removes exactly the catch it wrote, and puts the fly feedback back.
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ notes: "A" }), sampleEntry({ notes: "B" }), sampleEntry({ notes: "C" })]);
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      const fly = document.querySelector("#trip [data-on-water-fly]").textContent.trim();
      const feedbackBefore = flyFeedback[fly];
      // An edit form open on "B" must follow it as indices move.
      const editingBefore = getLogs()[1];
      editingLogIndex = 1;
      document.querySelector("#trip [data-fish-on]").click();
      const followed = getLogs()[editingLogIndex] === editingBefore;
      const during = getLogs().length;
      document.querySelector("#trip [data-fish-on-undo]").click();
      await new Promise((done) => requestAnimationFrame(done));
      const stored = JSON.parse(localStorage.getItem("riseLogs"));
      return {
        during, followed, after: getLogs().length,
        notes: getLogs().map((entry) => entry.notes).join(","),
        storedNotes: stored.map((entry) => entry.notes).join(","),
        stillEditing: getLogs()[editingLogIndex] === editingBefore,
        feedbackBefore: feedbackBefore || null, feedbackAfter: flyFeedback[fly] || null,
        undoGone: !document.querySelector("#trip [data-fish-on-undo]"),
        text: document.querySelector("#trip").textContent
      };
    }, measuredCrooked.toString());
    assert(result.during === 4 && result.after === 3, `Undo removes one catch (${result.during} -> ${result.after})`);
    assert(result.notes === "A,B,C" && result.storedNotes === "A,B,C", `and exactly that one - the rest are untouched (${result.notes})`);
    assert(result.followed && result.stillEditing, "an open edit form follows its catch through the insert and the undo");
    assert(result.feedbackAfter === result.feedbackBefore, `the fly feedback is put back (${result.feedbackBefore} -> ${result.feedbackAfter})`);
    assert(result.undoGone && /Catch removed/.test(result.text), "and the screen says it is gone");
    await page.close();
  }

  {
    // A write that fails writes nothing and says so.
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ notes: "A" })]);
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      const storedBefore = localStorage.getItem("riseLogs");
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); };
      document.querySelector("#trip [data-fish-on]").click();
      Storage.prototype.setItem = realSetItem;
      await new Promise((done) => requestAnimationFrame(done));
      return {
        count: getLogs().length,
        unchanged: localStorage.getItem("riseLogs") === storedBefore,
        error: document.querySelector("#trip .on-water-error")?.textContent || "",
        confirmation: Boolean(document.querySelector("#trip .on-water-logged"))
      };
    }, measuredCrooked.toString());
    assert(result.count === 1 && result.unchanged, `a failed write leaves the journal exactly as it was (${result.count})`);
    assert(/could not be saved/i.test(result.error) && /Nothing was logged/.test(result.error), `and the error is on screen (${result.error})`);
    assert(!result.confirmation, "with no confirmation claiming otherwise");
    await page.close();
  }

  {
    // Every primary control in the field view is at least 64pt.
    const page = await openApp(browser, { viewport: { width: 320, height: 640 } });
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      document.querySelector("#trip [data-fish-on]").click();
      await new Promise((done) => requestAnimationFrame(done));
      const small = [...document.querySelectorAll("#trip button")]
        .map((button) => ({ name: button.textContent.trim(), rect: button.getBoundingClientRect() }))
        .filter(({ rect }) => rect.height < 64 || rect.width < 64)
        .map(({ name, rect }) => `${name} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      const screen = document.querySelector("#trip");
      return { small, buttons: document.querySelectorAll("#trip button").length, overflow: screen.scrollWidth - screen.clientWidth };
    }, measuredCrooked.toString());
    assert(result.buttons >= 6 && !result.small.length, `every On the water button is at least 64pt at 320pt wide (${result.small.join(", ") || `${result.buttons} buttons`})`);
    assert(result.overflow <= 0, `and the view fits a 320pt screen (${result.overflow}px over)`);
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("On the water: next fly, countdown timer, wake lock, location, Live Activity bridge");

  {
    const page = await openApp(browser);
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      const shown = () => document.querySelector("#trip [data-on-water-fly]").textContent.trim();
      const first = shown();
      const firstList = liveRecommendedFlies(waterById("crooked"));
      // The place is remembered for the session, across tabs.
      document.querySelector("#trip [data-on-water-next-fly]").click();
      const beforeTabs = shown();
      activateTab("today");
      activateTab("trip");
      const afterTabs = shown();
      // Ignoring a fly lets the next candidate into the list, so the walk can
      // be longer than the four on screen; it must still come back round.
      const seen = [first, beforeTabs];
      for (let index = 0; index < 30 && seen[seen.length - 1] !== first; index += 1) {
        document.querySelector("#trip [data-on-water-next-fly]").click();
        seen.push(shown());
      }
      const rejected = seen.slice(0, -1);
      return {
        first, firstList, seen, beforeTabs, afterTabs,
        ignored: rejected.every((fly) => flyFeedback[fly] === "ignored"),
        distinct: new Set(rejected).size === rejected.length
      };
    }, measuredCrooked.toString());
    assert(result.firstList[0] === result.first, `the first fly shown is the top recommendation (${result.first})`);
    assert(result.beforeTabs !== result.first, `"Not working" moves to another fly (${result.first} > ${result.beforeTabs})`);
    assert(result.beforeTabs === result.afterTabs, `the place in the list survives leaving the screen (${result.afterTabs})`);
    assert(result.seen.length > 2 && result.distinct && result.seen[result.seen.length - 1] === result.first,
      `each fly is offered once before it comes round to the first again (${result.seen.join(" > ")})`);
    assert(result.ignored, "each rejected fly is recorded in the existing fly feedback as ignored");
    await page.close();
  }

  {
    const before = `
      window.__intervals = new Set();
      const realSetInterval = window.setInterval.bind(window);
      const realClearInterval = window.clearInterval.bind(window);
      window.setInterval = (...args) => { const id = realSetInterval(...args); window.__intervals.add(id); return id; };
      window.clearInterval = (id) => { window.__intervals.delete(id); return realClearInterval(id); };
      window.__wake = { requests: 0, releases: 0 };
      Object.defineProperty(navigator, "wakeLock", {
        configurable: true,
        value: { request: async () => {
          window.__wake.requests += 1;
          const sentinel = { onrelease: null, release: async () => { window.__wake.releases += 1; } };
          return sentinel;
        } }
      });
      window.__hidden = false;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__hidden });
    `;
    const page = await openApp(browser, { before });
    const result = await page.evaluate(async (open) => {
      const settle = () => new Promise((done) => setTimeout(done, 30));
      const live = () => window.__intervals.size;
      const baseline = live();
      eval(`(${open})`)();
      await settle();
      const opened = live();
      const text = document.querySelector("#trip [data-on-water-countdown]").textContent;
      for (let index = 0; index < 20; index += 1) renderAll();
      renderTrip();
      document.querySelector("#trip [data-fish-on]").click();
      await settle();
      const afterRenders = live();
      const wakeAfterOpen = { ...window.__wake };
      activateTab("today");
      await settle();
      const awayFromTrip = live();
      const wakeAway = { ...window.__wake };
      activateTab("trip");
      await settle();
      const backOnTrip = live();
      window.__hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
      const hidden = live();
      window.__hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
      const visible = live();
      const wakeVisible = { ...window.__wake };
      document.querySelector("#trip [data-on-water-close]").click();
      await settle();
      return {
        baseline, opened, afterRenders, awayFromTrip, backOnTrip, hidden, visible, closed: live(), text,
        wakeAfterOpen, wakeAway, wakeVisible, wakeClosed: { ...window.__wake }
      };
    }, measuredCrooked.toString());
    const on = (count) => count - result.baseline;
    assert(/^Prime window (ends in|starts in|has passed)|first calm hour/.test(result.text), `the countdown reads as one (${result.text})`);
    assert(on(result.opened) === 1, `opening the view starts one countdown timer (${on(result.opened)})`);
    assert(on(result.afterRenders) === 1, `21 re-renders and a Fish on! leave exactly one (${on(result.afterRenders)})`);
    assert(on(result.awayFromTrip) === 0, `leaving the Trip tab stops it (${on(result.awayFromTrip)})`);
    assert(on(result.backOnTrip) === 1, `coming back starts one again (${on(result.backOnTrip)})`);
    assert(on(result.hidden) === 0, `the app going to the background stops it (${on(result.hidden)})`);
    assert(on(result.visible) === 1, `coming back to the foreground starts one (${on(result.visible)})`);
    assert(on(result.closed) === 0, `Exit leaves none running (${on(result.closed)})`);
    assert(result.wakeAfterOpen.requests === 1, `the screen wake lock is asked for once, not per render (${result.wakeAfterOpen.requests})`);
    assert(result.wakeAway.releases === 1, "and released when the angler leaves the screen");
    assert(result.wakeVisible.requests >= 3, `and asked for again on return and on visibilitychange (${result.wakeVisible.requests})`);
    assert(result.wakeClosed.releases === result.wakeClosed.requests, `every lock taken is released by Exit (${result.wakeClosed.requests}/${result.wakeClosed.releases})`);
    await page.close();
  }

  {
    // No Wake Lock API at all (older WebKit): the view still works.
    const page = await openApp(browser, { before: `Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });` });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const opened = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      await new Promise((done) => setTimeout(done, 30));
      return Boolean(document.querySelector("#trip [data-on-water-view]"));
    }, measuredCrooked.toString());
    assert(opened && !errors.length, `without the Wake Lock API the view opens and nothing throws (${errors.join(" | ") || "no errors"})`);
    await page.close();
  }

  {
    const before = `
      window.__fix = null;
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: (success, failure) => {
          if (!window.__fix) { failure({ code: 1 }); return; }
          success({ coords: { latitude: window.__fix.lat, longitude: window.__fix.lon, accuracy: 15 } });
        } }
      });
    `;
    const page = await openApp(browser, { before });
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      const target = waterCoordinates.metolius;
      window.__fix = { lat: target.lat + .004, lon: target.lon + .004 };
      document.querySelector("#trip [data-on-water-locate]").click();
      await new Promise((done) => setTimeout(done, 30));
      const near = { water: activeWater, title: document.querySelector("#trip h1").textContent, notice: document.querySelector("#trip .on-water-notice")?.textContent || "" };
      window.__fix = { lat: 40.0, lon: -100.0 };
      document.querySelector("#trip [data-on-water-locate]").click();
      await new Promise((done) => setTimeout(done, 30));
      const far = { water: activeWater, notice: document.querySelector("#trip .on-water-notice")?.textContent || "" };
      window.__fix = null;
      document.querySelector("#trip [data-on-water-locate]").click();
      await new Promise((done) => setTimeout(done, 30));
      const denied = document.querySelector("#trip .on-water-notice")?.textContent || "";
      return { near, far, denied, name: waterById("metolius").name };
    }, measuredCrooked.toString());
    assert(result.near.water === "metolius" && result.near.title.includes(result.name) && /You look to be on/.test(result.near.notice),
      `a fix beside a mapped water picks that water (${result.near.water}: ${result.near.notice})`);
    assert(result.far.water === "metolius" && /Couldn't tell/.test(result.far.notice),
      `a fix near no water says it could not tell and changes nothing (${result.far.notice})`);
    assert(/Couldn't get your location/.test(result.denied), `a refused fix says so (${result.denied})`);
    await page.close();
  }

  {
    const before = `
      window.__liveActivity = [];
      window.webkit = { messageHandlers: { riseLiveActivity: { postMessage: (message) => window.__liveActivity.push(JSON.parse(JSON.stringify(message))) } } };
    `;
    const page = await openApp(browser, { before });
    const result = await page.evaluate(async (open) => {
      const atLaunch = window.__liveActivity.length;
      eval(`(${open})`)();
      const afterOpen = window.__liveActivity.length;
      for (let index = 0; index < 5; index += 1) renderTrip();
      const afterRepaints = window.__liveActivity.length;
      document.querySelector("#trip [data-fish-on]").click();
      document.querySelector("#trip [data-on-water-close]").click();
      return { atLaunch, afterOpen, afterRepaints, messages: window.__liveActivity };
    }, measuredCrooked.toString());
    const [start, update] = result.messages;
    const end = result.messages[result.messages.length - 1];
    assert(result.atLaunch === 0, "nothing is posted until On the water is opened");
    assert(start?.action === "start" && start.waterName === "Crooked River" && start.flow === "240 cfs" && start.flowSource === "measured" && start.nextFly,
      `opening posts start with the water, reading, provenance and next fly (${JSON.stringify(start)})`);
    assert(start && (start.primeWindowEnd === null || !Number.isNaN(Date.parse(start.primeWindowEnd))), "the prime-window end is a real instant");
    assert(result.afterRepaints === result.afterOpen, `an unchanged repaint posts nothing (${result.afterRepaints - result.afterOpen})`);
    assert(update?.action === "update" && update.fishToday === 1, `a catch posts an update (${JSON.stringify(update)})`);
    assert(end?.action === "end", "Exit ends the activity");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Audit round 2, batch 2: the journal, On the water and Snap a bug");

  {
    // B2: Fish on! is the first thing under the countdown, wholly above the
    // tab bar on a notched iPhone, with the regulations below the controls.
    for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
      const page = await openApp(browser, { url: insetAppUrl, viewport });
      const result = await page.evaluate(async (open) => {
        eval(`(${open})`)();
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        scrollAppToTop();
        const fishOn = document.querySelector("#trip [data-fish-on]").getBoundingClientRect();
        const bar = document.querySelector(".footer-tabs").getBoundingClientRect();
        const view = document.querySelector("#trip [data-on-water-view]");
        const order = [...view.children].map((child) => child.matches("[data-fish-on]") ? "fish-on"
          : child.matches(".regs-compact") ? "regs"
          : child.matches(".on-water-fly") ? "fly"
          : child.matches(".on-water-readings") ? "readings"
          : child.matches(".on-water-window") ? "window" : "");
        const regs = view.querySelector(".regs-compact");
        return {
          fishOnTop: Math.round(fishOn.top), fishOnBottom: Math.round(fishOn.bottom), barTop: Math.round(bar.top),
          order: order.filter(Boolean),
          regsHeight: Math.round(regs.getBoundingClientRect().height),
          regsText: regs.textContent.replace(/\s+/g, " "),
          regsLinks: regs.querySelectorAll("a.regs-link").length
        };
      }, measuredCrooked.toString());
      const label = `${viewport.width}x${viewport.height}`;
      assert(result.fishOnTop >= 0 && result.fishOnBottom <= result.barTop,
        `at ${label} with ${SAFE_AREA_TOP}/${SAFE_AREA_BOTTOM}pt insets, all of Fish on! is above the tab bar (${result.fishOnTop}-${result.fishOnBottom}px, bar at ${result.barTop}px)`);
      if (viewport.width === 390) {
        assert(result.order.join(",") === "window,fish-on,fly,readings,regs",
          `Fish on! comes straight after the prime window, and the regulations after the fly and readings (${result.order.join(", ")})`);
        assert(/Season|season/.test(result.regsText) && /Summary only/.test(result.regsText) && result.regsLinks === 2 && !/Next check for new ODFW|Checked for new ODFW|Couldn't check for new ODFW/.test(result.regsText),
          `the On the water regulations are the short block: status, gear, the summary note and links (${result.regsHeight}px)`);
      }
      await page.close();
    }
  }

  {
    // B1: a catch saved and deleted on the Log screen reaches Trip's
    // "Your <water>" card; Add details > Update keeps the Logged card honest.
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ notes: "A", flowSource: "measured", tempSource: "measured" }), sampleEntry({ notes: "B", flowSource: "measured", tempSource: "measured" })]);
    const result = await page.evaluate(async () => {
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      saveActiveWater("crooked");
      renderAll();
      activateTab("trip");
      const headline = () => document.querySelector("#trip [data-your-water]")?.textContent.replace(/\s+/g, " ") || "";
      const before = headline();
      activateTab("log");
      document.querySelector("[data-new-log]").click();
      const form = document.querySelector("#logForm");
      form.elements.water.value = "crooked";
      form.elements.notes.value = "third";
      await saveLogEntry(form);
      activateTab("trip");
      const afterSave = headline();
      activateTab("log");
      document.querySelector('#log [data-delete-log="0"]').click();
      activateTab("trip");
      const afterDelete = headline();
      await frame();
      return { before, afterSave, afterDelete, count: getLogs().length };
    });
    assert(/2 of 3 catches logged/.test(result.before) && /From your 3 catches/.test(result.afterSave),
      `a catch saved on the Log screen updates Trip's "Your water" card (${result.before.slice(0, 60)} -> ${result.afterSave.slice(0, 60)})`);
    assert(result.count === 2 && /2 of 3 catches logged/.test(result.afterDelete), "and so does a Delete");

    const details = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      document.querySelector("#trip [data-fish-on]").click();
      document.querySelector("#trip [data-fish-on-details]").click();
      const form = document.querySelector("#logForm");
      form.elements.notes.value = "big one";
      await saveLogEntry(form);
      activateTab("trip");
      const card = document.querySelector("#trip .on-water-logged");
      const text = card?.textContent.replace(/\s+/g, " ") || "";
      const undo = Boolean(card?.querySelector("[data-fish-on-undo]"));
      card?.querySelector("[data-fish-on-details]")?.click();
      return {
        text, undo, error: document.querySelector("#trip .on-water-error")?.textContent || "",
        tab: document.querySelector(".view.active").id,
        editingNotes: getLogs()[editingLogIndex]?.notes
      };
    }, measuredCrooked.toString());
    assert(/Logged/.test(details.text) && !details.undo,
      `after Add details > Update, On the water still shows the catch and offers no Undo (${details.text.trim().slice(0, 60)})`);
    assert(!details.error && details.tab === "log" && details.editingNotes === "big one",
      `and Add details opens the edited catch again, not "no longer in your journal" (${details.error || details.editingNotes})`);
    await page.close();
  }

  {
    // B3: a quick log for another water ends On the water rather than
    // silently moving it; one for the same water leaves it alone.
    const before = `
      window.__liveActivity = [];
      window.webkit = { messageHandlers: { riseLiveActivity: { postMessage: (message) => window.__liveActivity.push(message.action) } } };
    `;
    const page = await openApp(browser, { before });
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      activateTab("trip");
      const quickLog = (waterId) => {
        const button = document.createElement("button");
        button.dataset.quickLog = waterId;
        document.querySelector("#today").appendChild(button);
        button.click();
        button.remove();
      };
      quickLog("crooked");
      const same = { open: onWaterOpen, tab: document.querySelector(".view.active").id };
      document.querySelector("[data-new-log]").click();
      activateTab("trip");
      quickLog("metolius");
      const other = {
        open: onWaterOpen, water: activeWater, tab: document.querySelector(".view.active").id,
        formWater: document.querySelector("#logForm [name=water]")?.value
      };
      activateTab("trip");
      return {
        same, other,
        tripView: Boolean(document.querySelector("#trip [data-on-water-view]")),
        tripTitle: document.querySelector("#trip h1")?.textContent || "",
        activity: window.__liveActivity.slice()
      };
    }, measuredCrooked.toString());
    assert(result.same.open && result.same.tab === "log", "a quick log for the water On the water is showing keeps the session");
    assert(!result.other.open && result.other.water === "metolius" && result.other.formWater === "metolius",
      `a quick log for another water ends the session instead of retargeting it (${result.other.water})`);
    assert(!result.tripView && /Metolius/.test(result.tripTitle), `and Trip shows the new water, not a stale field view (${result.tripTitle})`);
    assert(result.activity[result.activity.length - 1] === "end", `the Live Activity is ended with it (${result.activity.join(", ")})`);
    await page.close();
  }

  {
    // B4: editing a Fish on! catch keeps a blank species and fly blank.
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ fish: "", fly: "", notes: "watch" })]);
    const result = await page.evaluate(async () => {
      activateTab("log");
      document.querySelector('#log [data-edit-log="0"]').click();
      const form = document.querySelector("#logForm");
      const shown = { fish: form.elements.fish.value, label: form.elements.fish.selectedOptions[0]?.textContent, fly: form.elements.fly.value };
      form.elements.notes.value = "edited";
      await saveLogEntry(form);
      const entry = getLogs()[0];
      return { shown, fish: entry.fish, fly: entry.fly, notes: entry.notes, worked: Object.values(flyFeedback).filter((value) => value === "worked").length };
    });
    assert(result.shown.fish === "" && result.shown.label === "Species not set" && result.shown.fly === "",
      `the edit form shows "Species not set" and an empty fly (${result.shown.label}, "${result.shown.fly}")`);
    assert(result.fish === "" && result.fly === "" && result.notes === "edited" && result.worked === 0,
      `and Update writes no guessed species or fly, and marks nothing worked (${result.fish || "blank"}, ${result.fly || "blank"})`);
    await page.close();
  }

  {
    // B5: a rough fix, and a fix that lands after Exit.
    const before = `
      window.__geo = [];
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: (success, failure, options) => window.__geo.push({ success, failure, options }) }
      });
    `;
    const page = await openApp(browser, { before });
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      const target = waterCoordinates.metolius;
      const fix = (accuracy) => ({ coords: { latitude: target.lat + .0005, longitude: target.lon, accuracy } });
      document.querySelector("#trip [data-on-water-locate]").click();
      const locating = document.querySelector("#trip [data-on-water-locate]");
      const disabled = { property: locating.disabled, attributes: locating.getAttributeNames() };
      window.__geo[0].success(fix(8000));
      const rough = { water: activeWater, notice: document.querySelector("#trip .on-water-notice")?.textContent || "", maximumAge: window.__geo[0].options.maximumAge };
      document.querySelector("#trip [data-on-water-locate]").click();
      document.querySelector("#trip [data-on-water-close]").click();
      window.__geo[1].success(fix(10));
      const afterExit = { water: activeWater, open: onWaterOpen, notice: onWaterNotice, title: document.querySelector("#trip h1").textContent };
      document.querySelector("[data-on-water-open]").click();
      document.querySelector("#trip [data-on-water-locate]").click();
      window.__geo[2].success(fix(10));
      const good = { water: activeWater, notice: document.querySelector("#trip .on-water-notice")?.textContent || "" };
      return { disabled, rough, afterExit, good };
    }, measuredCrooked.toString());
    assert(result.disabled.property && result.disabled.attributes.includes("disabled") && !result.disabled.attributes.includes("data-on-water-locatedisabled"),
      `while finding you, the button is really disabled (${result.disabled.attributes.join(" ")})`);
    assert(result.rough.maximumAge === 0, `it asks for a fresh fix, not one up to five minutes old (maximumAge ${result.rough.maximumAge})`);
    assert(result.rough.water === "crooked" && /too rough/.test(result.rough.notice),
      `an 8 km fix beside the Metolius picks nothing and says why (${result.rough.notice})`);
    assert(result.afterExit.water === "crooked" && !result.afterExit.open && !result.afterExit.notice && /Crooked/.test(result.afterExit.title),
      "a fix that arrives after Exit changes no water and leaves no notice");
    assert(result.good.water === "metolius" && /You look to be on/.test(result.good.notice), "a precise fix still finds the water");
    await page.close();
  }

  {
    // B6: Ignore on Trip's fly cards shows at once, and a second tap undoes it.
    const page = await openApp(browser);
    const result = await page.evaluate(() => {
      saveActiveWater("crooked");
      renderAll();
      activateTab("trip");
      const button = () => document.querySelector('#trip [data-feedback-value="ignored"]');
      const fly = button().dataset.flyFeedback;
      button().click();
      const afterFirst = { stored: flyFeedback[fly], active: [...document.querySelectorAll("#trip [data-feedback-value=ignored]")].some((item) => item.dataset.flyFeedback === fly && item.classList.contains("active")) };
      [...document.querySelectorAll("#trip [data-feedback-value=ignored]")].find((item) => item.dataset.flyFeedback === fly).click();
      return { fly, afterFirst, afterSecond: flyFeedback[fly] || null };
    });
    assert(result.afterFirst.stored === "ignored" && result.afterFirst.active,
      `tapping Ignore on Trip marks the fly and the button shows it (${result.fly})`);
    assert(result.afterSecond === null, "and the second tap clears it, as the button says");
    await page.close();
  }

  {
    // B7: "N of M" counts up over a frozen list; a fly that worked keeps Worked.
    const page = await openApp(browser);
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      const label = () => document.querySelector("#trip .on-water-fly .on-water-label").textContent;
      const shown = () => document.querySelector("#trip [data-on-water-fly]").textContent.trim();
      const order = onWaterFlies(waterById("crooked")).slice();
      flyFeedback[order[2]] = "worked";
      renderTrip();
      const walk = [];
      for (let index = 0; index < order.length + 1; index += 1) {
        walk.push({ label: label(), fly: shown() });
        document.querySelector("#trip [data-on-water-next-fly]").click();
      }
      return { order, walk, worked: flyFeedback[order[2]], ignored: order.filter((fly, index) => index !== 2).every((fly) => flyFeedback[fly] === "ignored") };
    }, measuredCrooked.toString());
    const count = result.order.length;
    assert(count >= 3 && result.walk.slice(0, count).map((step) => step.label).join("|") === result.order.map((fly, index) => `Next fly to try - ${index + 1} of ${count}`).join("|"),
      `the position counts 1 of ${count} up to ${count} of ${count} (${result.walk.map((step) => step.label.replace("Next fly to try - ", "")).join(", ")})`);
    assert(result.walk.slice(0, count).map((step) => step.fly).join("|") === result.order.join("|") && result.walk[count].fly === result.order[0],
      "over the list frozen when the view opened, with no fly sliding in, and then round to the first");
    assert(result.worked === "worked" && result.ignored,
      `a fly marked Worked is skipped for the session but stays Worked (${result.order[2]})`);
    await page.close();
  }

  {
    // B9: a bug photo attached to a new catch does not ride on to an edit,
    // or from there on to a later, unrelated catch.
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ notes: "A" })]);
    const result = await page.evaluate(async () => {
      const photo = document.createElement("canvas");
      photo.width = 40;
      photo.height = 40;
      photo.getContext("2d").fillRect(0, 0, 40, 40);
      proAccessActive = true;
      snapBug = { status: "ready", photo: photo.toDataURL("image/jpeg"), photoUrl: "", error: "", sample: null, autoColor: "" };
      renderAll();
      activateTab("bugs");
      document.querySelector("#bugs [data-snap-attach]").click();
      const attached = Boolean(document.querySelector("#logForm [data-log-attached-photo] img"));
      document.querySelector('#log [data-edit-log="0"]').click();
      const editForm = document.querySelector("#logForm");
      const onEdit = Boolean(editForm.querySelector("[data-log-attached-photo] img"));
      await saveLogEntry(editForm);
      document.querySelector("[data-new-log]").click();
      const newForm = document.querySelector("#logForm");
      const onNew = Boolean(newForm.querySelector("[data-log-attached-photo] img"));
      await saveLogEntry(newForm);
      return { attached, onEdit, onNew, photos: getLogs().filter((entry) => entry.photo || entry.photoId).length, count: getLogs().length };
    });
    assert(result.attached && !result.onEdit, "switching the form to Edit drops the bug photo held for a new catch");
    assert(!result.onNew && result.count === 2 && result.photos === 0, `and the next new catch is saved without it (${result.photos} photos)`);
    await page.close();
  }

  {
    // B10: a legacy entry known only by name keeps its readings through an edit.
    const page = await openApp(browser);
    await seedLogs(page, [sampleEntry({ waterId: undefined, waterName: "Crooked River", flow: "235 cfs", flowSource: "measured", temp: "53 F", tempSource: "measured" })]);
    const result = await page.evaluate(async () => {
      activateTab("log");
      document.querySelector('#log [data-edit-log="0"]').click();
      const form = document.querySelector("#logForm");
      const selected = form.elements.water.value;
      form.elements.notes.value = "added a note";
      await saveLogEntry(form);
      const entry = getLogs()[0];
      return { selected, flow: entry.flow, flowSource: entry.flowSource, temp: entry.temp, notes: entry.notes };
    });
    assert(result.selected === "crooked" && result.notes === "added a note", "a name-only legacy entry edits on the water it names");
    assert(result.flow === "235 cfs" && result.flowSource === "measured" && result.temp === "53 F",
      `and keeps the readings it was caught with (${result.flow} ${result.flowSource}, ${result.temp})`);
    await page.close();
  }

  {
    // B11a: when Undo expires, Add details stays where it was.
    const page = await openApp(browser, { viewport: { width: 390, height: 844 } });
    const result = await page.evaluate(async (open) => {
      eval(`(${open})`)();
      document.querySelector("#trip [data-fish-on]").click();
      const rect = (selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? [box.left, box.top, box.width, box.height].map(Math.round).join(",") : "";
      };
      const undoBefore = rect("#trip [data-fish-on-undo]");
      const detailsBefore = rect("#trip [data-fish-on-details]");
      // What the 8-second timer does when it fires.
      clearTimeout(fishOnUndoTimer);
      fishOnUndoTimer = null;
      fishOnUndo = null;
      renderScreens("trip");
      const placeholder = document.querySelector("#trip [data-fish-on-undo-expired]");
      const box = placeholder.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      hit.click();
      return {
        undoBefore, detailsBefore, detailsAfter: rect("#trip [data-fish-on-details]"),
        placeholder: rect("#trip [data-fish-on-undo-expired]"), disabled: placeholder.disabled,
        tab: document.querySelector(".view.active").id, editing: editingLogIndex
      };
    }, measuredCrooked.toString());
    assert(result.detailsBefore && result.detailsAfter === result.detailsBefore,
      `Add details does not move when Undo expires (${result.detailsBefore} -> ${result.detailsAfter})`);
    assert(result.placeholder === result.undoBefore && result.disabled,
      `Undo's cell is kept by a disabled button (${result.placeholder})`);
    assert(result.tab === "trip" && result.editing === null, "and a tap where Undo was opens nothing");
    await page.close();
  }

  /* ---------------------------------------------------------------- */
  group("Apple Watch: catches from the Watch reach the journal once, and only a saved catch is acknowledged");

  const watchBridge = `
    window.__watch = [];
    window.webkit = { messageHandlers: { riseWatch: { postMessage: (message) => window.__watch.push(JSON.parse(JSON.stringify(message))) } } };
  `;
  const watchCatchFixture = (watchId, loggedAt, extra = {}) => ({
    watchId, loggedAt, date: "Jun 21, 2026", time: "11:00 AM", waterId: "metolius", waterName: "Metolius River",
    fly: "BWO Emerger #18", fish: "Redband Trout", length: "15.5", count: "1", notes: "",
    flow: "1,520 cfs", flowSource: "stale", temp: "48 F", tempSource: "measured", ...extra
  });

  {
    const page = await openApp(browser, { before: watchBridge });
    await seedLogs(page, [
      sampleEntry({ loggedAt: "2026-06-21T20:00:00.000Z", notes: "NEWEST", fly: "Newest Fly" }),
      sampleEntry({ loggedAt: "2026-06-21T15:00:00.000Z", notes: "MIDDLE", fly: "Middle Fly" }),
      sampleEntry({ loggedAt: "2026-06-20T15:00:00.000Z", notes: "OLDEST", fly: "Oldest Fly" })
    ]);
    const catches = [
      watchCatchFixture("A1B2C3D4-0000-4000-8000-000000000001", "2026-06-21T18:00:00.000Z"),
      watchCatchFixture("A1B2C3D4-0000-4000-8000-000000000002", "2026-06-21T16:30:00.000Z", { fish: "", length: "", fly: "<b>Bold</b> Nymph" })
    ];
    const result = await page.evaluate(async (delivered) => {
      window.__watch.length = 0;
      activateTab("log");
      await new Promise((done) => requestAnimationFrame(done));
      // The edit form is open on MIDDLE (index 1) when the Watch catches land.
      document.querySelector("[data-edit-log='1']").click();
      await new Promise((done) => requestAnimationFrame(done));
      const formBefore = document.querySelector("#logForm");
      window.riseWatchCatches({ catches: delivered });
      await new Promise((done) => requestAnimationFrame(done));
      const first = {
        notes: getLogs().map((entry) => entry.notes || entry.watchId),
        editing: getLogs()[editingLogIndex]?.notes,
        formKept: document.querySelector("#logForm") === formBefore,
        formFly: document.querySelector("#logForm [name=fly]")?.value,
        cards: [...document.querySelectorAll("#log .catch-card")].map((node) => node.textContent.replace(/\s+/g, " ").trim()),
        tags: document.querySelectorAll("#log [data-watch-tag]").length,
        boldTags: document.querySelectorAll("#log .catch-card b").length,
        notice: document.querySelector("#log [data-watch-notice]")?.textContent || "",
        acks: window.__watch.filter((message) => message.action === "catchesSaved"),
        stored: JSON.parse(localStorage.getItem("riseLogs")).filter((entry) => entry.loggedOn === "watch")
      };
      window.riseWatchCatches({ catches: delivered });
      await new Promise((done) => requestAnimationFrame(done));
      const second = {
        count: getLogs().length,
        tags: document.querySelectorAll("#log [data-watch-tag]").length,
        acks: window.__watch.filter((message) => message.action === "catchesSaved").length
      };
      return { first, second };
    }, catches);
    const { first, second } = result;
    assert(first.notes.join(",") === "NEWEST,A1B2C3D4-0000-4000-8000-000000000001,A1B2C3D4-0000-4000-8000-000000000002,MIDDLE,OLDEST",
      `Watch catches land in loggedAt order among the phone's own (${first.notes.join(", ")})`);
    assert(first.editing === "MIDDLE" && first.formKept && first.formFly === "Middle Fly",
      `the open edit form stays on the catch it was editing (${first.editing}, ${first.formFly})`);
    assert(first.tags === 2 && first.cards.filter((text) => /Logged on Apple Watch/.test(text)).length === 2, "each Watch catch is marked as logged on the Watch");
    const watchCard = first.cards.find((text) => /Metolius/.test(text) && /15\.5/.test(text)) || "";
    assert(/Redband Trout - 15\.5"/.test(watchCard) && /BWO Emerger #18/.test(watchCard) && /1,520 cfs \(measured earlier\)/.test(watchCard) && /48 F \(measured\)/.test(watchCard),
      `a Watch card shows its species, length, fly and readings with their provenance (${watchCard})`);
    assert(first.boldTags === 0 && first.cards.some((text) => text.includes("<b>Bold</b> Nymph")), "a fly name from the Watch is escaped, not parsed");
    const stored = first.stored.find((entry) => entry.watchId.endsWith("0001"));
    assert(stored && stored.date === "Jun 21, 2026" && stored.time === "11:00 AM" && stored.count === "1" && stored.waterId === "metolius" && stored.loggedAt === "2026-06-21T18:00:00.000Z",
      `the stored entry has the journal's own fields and Oregon date and time (${JSON.stringify(stored)})`);
    assert(first.acks.length === 1 && first.acks[0].ids.length === 2, `both catches are acknowledged once, after the write (${JSON.stringify(first.acks)})`);
    assert(/Added 2 catches from your Apple Watch/.test(first.notice), `the journal says what arrived (${first.notice})`);
    assert(second.count === 5 && second.tags === 2, `a second delivery of the same catches adds nothing (${second.count} entries)`);
    assert(second.acks === 2, "and is acknowledged again so the iPhone can let go of them");
    await page.close();
  }

  {
    // Delivered, deleted on the phone, then delivered again (the Watch resent
    // it, or the iPhone offered it again): acknowledged, never re-inserted -
    // also after the app is reopened.
    const page = await openApp(browser, { before: watchBridge });
    await seedLogs(page, [sampleEntry({ notes: "PHONE", loggedAt: "2026-06-21T20:00:00.000Z" })]);
    const watchId = "A1B2C3D4-0000-4000-8000-0000000000DE";
    const delivered = [watchCatchFixture(watchId, "2026-06-21T18:00:00.000Z")];
    const landed = await page.evaluate(async (catches, id) => {
      window.__watch.length = 0;
      activateTab("log");
      await new Promise((done) => requestAnimationFrame(done));
      window.riseWatchCatches({ catches });
      await new Promise((done) => requestAnimationFrame(done));
      const index = getLogs().findIndex((entry) => entry.watchId === id);
      document.querySelector(`[data-delete-log='${index}']`).click();
      await new Promise((done) => requestAnimationFrame(done));
      const afterDelete = getLogs().map((entry) => entry.watchId || entry.notes);
      window.__watch.length = 0;
      window.riseWatchCatches({ catches });
      await new Promise((done) => requestAnimationFrame(done));
      return {
        index,
        afterDelete,
        afterRedeliver: getLogs().map((entry) => entry.watchId || entry.notes),
        cards: document.querySelectorAll("#log [data-watch-tag]").length,
        acks: window.__watch.filter((message) => message.action === "catchesSaved")
      };
    }, delivered, watchId);
    assert(landed.index >= 0 && landed.afterDelete.join(",") === "PHONE", `the Watch catch landed and the Delete button removed it (${landed.afterDelete.join(",")})`);
    assert(landed.afterRedeliver.join(",") === "PHONE" && landed.cards === 0, `delivered again, it is not re-inserted (${landed.afterRedeliver.join(",")})`);
    assert(landed.acks.length === 1 && landed.acks[0].ids.join(",") === watchId, `but it is acknowledged again so the iPhone and the Watch let go of it (${JSON.stringify(landed.acks)})`);
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done())));
    const reopened = await page.evaluate(async (catches) => {
      window.__watch.length = 0;
      window.riseWatchCatches({ catches });
      await new Promise((done) => requestAnimationFrame(done));
      return {
        logs: getLogs().map((entry) => entry.watchId || entry.notes),
        acks: window.__watch.filter((message) => message.action === "catchesSaved").length
      };
    }, delivered);
    assert(reopened.logs.join(",") === "PHONE" && reopened.acks === 1, `and still not after the app is reopened (${reopened.logs.join(",")}, ${reopened.acks} ack)`);
    await page.close();
  }

  {
    const page = await openApp(browser, { before: watchBridge });
    await seedLogs(page, [sampleEntry({ notes: "ONLY", loggedAt: "2026-06-21T20:00:00.000Z" })]);
    const result = await page.evaluate(async (delivered) => {
      window.__watch.length = 0;
      activateTab("log");
      await new Promise((done) => requestAnimationFrame(done));
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "riseLogs") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return realSetItem.call(this, key, value);
      };
      window.riseWatchCatches({ catches: delivered });
      Storage.prototype.setItem = realSetItem;
      await new Promise((done) => requestAnimationFrame(done));
      return {
        count: getLogs().length,
        stored: JSON.parse(localStorage.getItem("riseLogs")).length,
        acks: window.__watch.filter((message) => message.action === "catchesSaved").length,
        notice: document.querySelector("#log [data-watch-notice]")?.textContent || "",
        role: document.querySelector("#log [data-watch-notice]")?.getAttribute("role") || "",
        tags: document.querySelectorAll("#log [data-watch-tag]").length
      };
    }, [watchCatchFixture("A1B2C3D4-0000-4000-8000-000000000009", "2026-06-21T18:00:00.000Z")]);
    assert(result.count === 1 && result.stored === 1 && result.tags === 0, `a full device adds nothing to the journal (${result.count})`);
    assert(result.acks === 0, "and sends no acknowledgement, so the iPhone keeps the catch");
    assert(/could not be saved/.test(result.notice) && result.role === "alert", `and the angler is told (${result.notice})`);
    await page.close();
  }

  {
    // The pack: posted once the page settles, not again for a repaint that
    // changed nothing, and again when a saved water changes.
    const page = await openApp(browser, { before: watchBridge });
    const result = await page.evaluate(async () => {
      const packs = () => window.__watch.filter((message) => message.action === "pack");
      await new Promise((done) => setTimeout(done, WATCH_PACK_DEBOUNCE_MS + 300));
      const atLaunch = packs().length;
      const pack = atLaunch ? JSON.parse(packs()[0].body) : null;
      for (let index = 0; index < 10; index += 1) renderAll();
      await new Promise((done) => setTimeout(done, WATCH_PACK_DEBOUNCE_MS + 300));
      const afterRepaints = packs().length;
      toggleSavedWater("hosmer");
      renderAll();
      await new Promise((done) => setTimeout(done, WATCH_PACK_DEBOUNCE_MS + 300));
      const latest = JSON.parse(packs()[packs().length - 1].body);
      return { atLaunch, afterRepaints, afterSave: packs().length, pack, hasHosmer: latest.waters.some((water) => water.id === "hosmer") };
    });
    assert(result.atLaunch === 1, `one pack is posted after launch (${result.atLaunch})`);
    assert(result.pack && result.pack.waters.length >= 1 && result.pack.waters.every((water) => water.flow && water.temp && water.flow.source && water.temp.source),
      "every water in it carries both readings with their provenance");
    assert(result.afterRepaints === 1, `ten repaints that changed nothing post nothing (${result.afterRepaints - 1})`);
    assert(result.afterSave === 2 && result.hasHosmer, `saving a water posts one new pack that includes it (${result.afterSave - 1})`);
    await page.close();
  }

  {
    // No Watch bridge (the web build, or an iPhone build before this one):
    // nothing is posted and nothing throws.
    const page = await openApp(browser);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = await page.evaluate(async () => {
      await new Promise((done) => setTimeout(done, WATCH_PACK_DEBOUNCE_MS + 200));
      return { timer: watchPackTimer, posted: watchPackPostedKey };
    });
    assert(result.timer === null && result.posted === null && !errors.length, "without the riseWatch handler no pack is built or posted");
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
