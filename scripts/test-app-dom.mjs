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

import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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

async function openApp(browser, { fetchPlan } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932 });
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
      const screens = ["today", "waters", "trip", "bugs", "log", "knots", "pro"];
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
      const screens = ["today", "waters", "trip", "bugs", "log", "knots", "pro"];
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
} finally {
  await browser.close();
  if (!process.env.RISE_DOM_TEST_WORKDIR) rmSync(workRoot, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
