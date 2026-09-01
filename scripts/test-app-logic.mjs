#!/usr/bin/env node
/**
 * Headless behaviour tests for the-rise-app.html.
 *
 * The app is one HTML file with no build step, so there was nowhere for a test
 * to live. This harness stubs just enough DOM to evaluate the app script, then
 * asserts on the scoring, seasonality, provenance and catch-log behaviour that
 * used to be impossible to check without a device.
 *
 * Run: node scripts/test-app-logic.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
/* Minimal DOM                                                         */
/* ------------------------------------------------------------------ */

function makeElement(id = "") {
  const element = {
    id,
    dataset: {},
    style: {},
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      toggle(name, force) { force ? this._set.add(name) : this._set.delete(name); },
      contains(name) { return this._set.has(name); }
    },
    innerHTML: "",
    children: [],
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    appendChild() {},
    removeChild() {},
    scrollIntoView() {},
    click() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return null; }
  };
  return element;
}

const elements = new Map();
function elementFor(key) {
  if (!elements.has(key)) elements.set(key, makeElement(String(key).replace(/^#/, "")));
  return elements.get(key);
}

// The single active screen, so activeScreenId() has something to find.
const activeView = makeElement("today");
activeView.classList.add("active");

const document = {
  querySelector(selector) {
    if (selector === ".view.active") return activeView;
    return elementFor(selector);
  },
  querySelectorAll() { return []; },
  createElement(tag) { return makeElement(tag); },
  addEventListener() {},
  body: makeElement("body"),
  documentElement: makeElement("html")
};

const storage = new Map();
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); }
};

const context = {
  console,
  document,
  localStorage,
  navigator: { onLine: true, geolocation: { getCurrentPosition() {} } },
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval,
  Intl,
  Date,
  Math,
  JSON,
  URL: { createObjectURL: () => "blob:stub", revokeObjectURL() {} },
  Blob: class { constructor(parts) { this.parts = parts; } },
  FileReader: class { readAsDataURL() {} },
  Image: class {},
  fetch: () => Promise.reject(new Error("network disabled in tests")),
  AbortController: class { constructor() { this.signal = {}; } abort() {} },
  addEventListener() {},
  removeEventListener() {},
  scrollTo() {},
  webkit: undefined
};
context.window = context;
context.globalThis = context;

/* ------------------------------------------------------------------ */
/* Evaluate the app script                                             */
/* ------------------------------------------------------------------ */

const html = readFileSync(join(root, "the-rise-app.html"), "utf8");
const scriptBody = html.slice(html.indexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

vm.createContext(context);
// Expose the app's top-level declarations for assertions.
vm.runInContext(`${scriptBody}\n;globalThis.__app = {
  waters, bugs, liveSources, waterCoordinates,
  parseSeasonMonths, hatchSeasonFit, hatchInSeason, seasonLabelFor,
  fishScore, flowFromText, flowRatioFor, flowScoreAdjustment, seasonFitFor,
  primeWindowHours, primeWindowFor, timeOfDayFit,
  valueProvenance, liveDisplayValue, hasLiveSource, hasGauge, clarityFor,
  predictedHatches, waterAppropriateHatches,
  getLogs, setLogs, logCsv, formatLogDate, normalizeLogEntry,
  liveReports, PRO_FEATURES, screenRenderers
};`, context);

const app = context.__app;

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

group("Seasonality (#4)");
assert(JSON.stringify(app.parseSeasonMonths("Mar-May, Oct-Nov")) === JSON.stringify([3, 4, 5, 10, 11]),
  "parses a two-range season string");
assert(app.parseSeasonMonths("Year-round").length === 12, "year-round covers every month");
assert(app.parseSeasonMonths("Nov-Feb").join(",") === "1,2,11,12", "handles a season that wraps the year");
assert(app.parseSeasonMonths("nonsense") === null, "unparseable season returns null");
assert(app.hatchSeasonFit("Green Drake", 1) === 0, "Green Drake is out of season in January");
assert(app.hatchSeasonFit("Green Drake", 6) === 1, "Green Drake is in season in June");
assert(app.hatchSeasonFit("Green Drake", 8) === .5, "Green Drake scores as shoulder season in August");
assert(app.hatchSeasonFit("Chironomid", 1) === 1, "year-round chironomid is always in season");
assert(app.hatchSeasonFit("Unmapped Bug", 1) === 1, "an unmapped hatch is never silently suppressed");

const highLake = app.waters.find((water) => water.id === "todd-lake");
const januaryHatches = app.waterAppropriateHatches(highLake.hatch, highLake, { month: 1 });
assert(!januaryHatches.some((hatch) => /drake|damsel|callibaetis/i.test(hatch)),
  "January on a high lake suggests no summer mayflies or damsels");
assert(januaryHatches.length > 0, "January still returns a usable fallback plan");

group("Flow scoring (#4)");
assert(app.flowFromText("4,160 cfs") === 4160, "flow parser handles thousands separators");
assert(app.flowFromText("235 cfs") === 235, "flow parser handles plain values");
const crooked = app.waters.find((water) => water.id === "crooked");
app.liveReports.byWater[crooked.id] = { status: "ready", usgs: { flow: "3,000 cfs" }, nws: {} };
assert(app.flowScoreAdjustment(crooked) < 0, "flow far above reference penalises the score");
const highFlowScore = Number(app.fishScore(crooked));
app.liveReports.byWater[crooked.id] = { status: "ready", usgs: { flow: "240 cfs" }, nws: {} };
assert(app.flowScoreAdjustment(crooked) > 0, "flow near reference rewards the score");
const goodFlowScore = Number(app.fishScore(crooked));
assert(goodFlowScore > highFlowScore, "a blown-out river scores below one at normal flow");
delete app.liveReports.byWater[crooked.id];

group("Time of day (#4)");
const window = app.primeWindowHours(crooked);
assert(Array.isArray(window) && window.length === 2, "prime window is a real hour range");
assert(app.timeOfDayFit(crooked) >= 0 && app.timeOfDayFit(crooked) <= 1, "time-of-day fit stays in range");
assert(/Prime window/.test(app.primeWindowFor(crooked)), "prime window still renders a label");

group("Data provenance (#3)");
const ungauged = app.waters.find((water) => water.id === "yoran-lake");
assert(app.hasLiveSource(ungauged) === false, "an unsourced water reports no live feed");
assert(app.valueProvenance(ungauged, "temp") === "reference", "unsourced water temp is labelled reference");
assert(app.valueProvenance(ungauged, "wind") === "reference", "unsourced wind is labelled reference");
const gauged = app.waters.find((water) => water.id === "lower-deschutes");
assert(app.hasGauge(gauged) === true, "the Lower Deschutes has a mapped gauge");
app.liveReports.byWater[gauged.id] = { status: "ready", usgs: { flow: "4,200 cfs", waterTemp: "54 F" }, nws: { air: "70 F", wind: "6 mph W" } };
assert(app.valueProvenance(gauged, "flow") === "measured", "a fetched flow is labelled measured");
assert(app.valueProvenance(gauged, "air") === "measured", "a fetched air temp is labelled measured");
delete app.liveReports.byWater[gauged.id];
assert(app.valueProvenance(gauged, "flow") === "reference", "without a fetch the same value falls back to reference");
assert(!/demo cache/i.test(html), "no fabricated cache timestamps remain in the app");
assert(app.clarityFor(ungauged).measured === false, "clarity never claims to be measured");
assert(!/\d+"/.test(app.clarityFor(ungauged).inches), "clarity no longer invents inch readings");

group("Coordinates (#5)");
const missingCoords = app.waters.filter((water) => !app.waterCoordinates[water.id]);
assert(missingCoords.length === 0, `every water has coordinates (missing: ${missingCoords.map((w) => w.id).join(", ") || "none"})`);
const duplicated = Object.keys(app.liveSources).filter((id) => "lat" in app.liveSources[id] || "lon" in app.liveSources[id]);
assert(duplicated.length === 0, `liveSources holds no second copy of any coordinate (found: ${duplicated.join(", ") || "none"})`);

group("Catch log (#2)");
localStorage.clear();
const many = Array.from({ length: 25 }, (unused, index) => ({
  loggedAt: new Date(2026, 5, index + 1).toISOString(),
  date: "Jun 1, 2026",
  waterName: "Crooked River",
  waterId: "crooked",
  fly: "Zebra Midge #20",
  fish: "Redband Trout",
  length: "14",
  count: "1",
  notes: `entry ${index}`,
  temp: "55 F",
  flow: "235 cfs"
}));
assert(app.setLogs(many) === true, "a 25-entry journal saves");
assert(app.getLogs().length === 25, "all 25 entries survive - the 8-entry cap is gone");
assert(!/(nextLogs|logs)\s*=\s*[^;]*\.slice\(0, 8\)/.test(html), "no eight-entry truncation remains on the catch-log save path");
assert(/\d{4}/.test(app.formatLogDate(many[0])), "log dates carry a year");
const csv = app.logCsv();
assert(csv.split("\r\n").length === 26, "CSV export contains a header plus every entry");
assert(csv.startsWith('"Date","Time","Water"'), "CSV export has a header row");
assert(csv.includes('"entry 24"'), "CSV export includes the last entry");
const stored = JSON.parse(localStorage.getItem("riseLogs"));
assert(stored.every((entry) => !entry.photo), "no base64 photo payloads are written into localStorage");
assert(JSON.stringify(stored).length < 12000, "25 entries stay far inside the localStorage quota");

group("Pro gating (#1)");
assert(app.PRO_FEATURES.length === 4, "the paywall lists four features");
const proText = JSON.stringify(app.PRO_FEATURES).toLowerCase();
assert(!proText.includes("alert"), "the paywall no longer promises alerts the app cannot send");
assert(!/stocking alerts|hatch alerts/i.test(html), "alert claims are gone from the app entirely");
assert(/if \(!proAccessActive\)/.test(html), "proAccessActive actually gates rendering");
const gateCount = (html.match(/if \(!proAccessActive\)/g) || []).length;
assert(gateCount >= 4, `Pro gates at least four surfaces (found ${gateCount})`);

group("Rendering (#5)");
assert(Object.keys(app.screenRenderers).length === 7, "all seven screens are registered");
assert(/dirtyScreens/.test(html), "screens are tracked for deferred rendering");

// Every screen must render without throwing and produce real markup. This is
// what catches a template referencing a function that no longer exists.
for (const [id, render] of Object.entries(app.screenRenderers)) {
  let markup = "";
  let threw = null;
  try {
    render();
    markup = elementFor(`#${id}`).innerHTML;
  } catch (error) {
    threw = error;
  }
  assert(!threw, `${id} renders without throwing${threw ? ` (${threw.message})` : ""}`);
  assert(markup.length > 200, `${id} produces markup`);
  assert(!markup.includes("undefined"), `${id} markup contains no undefined values`);
  assert(!markup.includes("[object Object]"), `${id} markup contains no stringified objects`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
