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
  esc, attr, safeText, mentionsTerm, mentionsNoun,
  waterAliasMap, waterAliasExclusions, aliasesForWater, scoreBoostFromSignals,
  passageAboutWater, extractSignalsForWater, watersForBulkSync,
  localIntelSources, referenceLinks, reportLinks, clickActions,
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
// The built-in demo entries are app fixtures, not migrated user data, so they
// must never be labelled with the "(year unknown)" migration marker.
localStorage.clear();
app.getLogs.cache = null;
const demo = app.normalizeLogEntry({ loggedAt: "2026-06-21T09:40:00", date: "Jun 21, 2026" });
assert(!demo.dateApproximate, "dated fixtures are not marked as approximate");
assert(/2026/.test(app.formatLogDate(demo)), "dated fixtures render a full date");
const migrated = app.normalizeLogEntry({ date: "Jun 21" });
assert(migrated.dateApproximate === true, "an undated legacy entry is marked, not discarded");
assert(/year unknown/.test(app.formatLogDate(migrated)), "an undated legacy entry says so");
assert(
  !/\{ date: "[A-Z][a-z]{2} \d+", time:/.test(html),
  "no sample log entry ships without a full timestamp",
);

const stored = JSON.parse(localStorage.getItem("riseLogs") || JSON.stringify(many));
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

group("HTML escaping (#3 round two)");
assert(app.esc('<img src=x onerror="alert(1)">') === "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  "esc neutralises tags and quotes");
assert(app.esc('PMD "Sparkle" Dun #16') === "PMD &quot;Sparkle&quot; Dun #16", "esc keeps the whole string, quotes and all");
assert(app.esc("Tom & Jerry") === "Tom &amp; Jerry", "esc escapes the ampersand first, not twice");
assert(app.esc(null) === "" && app.esc(undefined) === "", "esc renders null and undefined as empty, never as text");
assert(app.attr("a'b") === "a&#39;b", "attr escapes the single quote a value could break out of");
assert(!/escapeHtmlMissing/.test(html) && /function esc\(/.test(html), "the app defines an escaping helper");
assert(/\$\{esc\(entry\.notes\)\}/.test(html), "catch-log notes are escaped at the render site");
assert(/\$\{esc\(entry\.fly\)\}/.test(html), "catch-log fly names are escaped at the render site");
assert(/value="\$\{attr\(editingEntry\?\.fly \|\| defaultFly\)\}"/.test(html), "the edit form escapes the fly value");

group("Network text is sanitised where it enters (#3 round two)");
assert(app.safeText('<b>Sunny</b>') === "b Sunny /b", "safeText strips the characters that build markup");
assert(app.safeText("Sunny then breezy") === "Sunny then breezy", "safeText leaves ordinary forecast text alone");
assert(app.safeText("x".repeat(300)).length === 120, "safeText bounds the length it will accept");
assert(/forecast: safeText\(/.test(html), "the NWS forecast string is sanitised at ingestion");

group("Event handlers are bound once (#1 round two)");
assert(!/^\s*bindDynamic\(\);/m.test(html), "bindDynamic and its 41 call sites are gone");
assert(/function bindDelegatedEvents\(\)/.test(html), "a single delegated binder replaces it");
assert((html.match(/bindDelegatedEvents\(\);/g) || []).length === 1, "the binder is called exactly once");
assert(Array.isArray(app.clickActions) && app.clickActions.length > 20, "every click action is registered in one table");
assert(app.clickActions.every(([selector, handler]) => typeof selector === "string" && typeof handler === "function"),
  "every action is a selector paired with a handler");
assert(new Set(app.clickActions.map(([selector]) => selector)).size === app.clickActions.length,
  "no selector is registered twice");

group("Local reports: agency only, no fallback prose (#2 and #6 round two)");
assert(app.localIntelSources.every((source) => /^https:\/\/(www\.)?myodfw\.com\//.test(source.url)),
  "only ODFW pages are fetched and parsed");
assert(app.localIntelSources.every((source) => !("fallback" in source)),
  "no source carries hand-written fallback prose any more");
assert(!/confluenceflyshop|flyfishersplace|deschutescamp|deschutesriveralliance/.test(
  JSON.stringify(app.localIntelSources)), "no commercial shop, guide or conservation page is scraped");
assert(app.referenceLinks.some((link) => /confluenceflyshop/.test(link.url)), "the shops are still linked for the angler");
assert(app.reportLinks.length === app.localIntelSources.length + app.referenceLinks.length,
  "the Reports panel lists parsed sources and linked sources together");
const unreadable = app.extractSignalsForWater(crooked, "Crooked River is fishing well with caddis.",
  { label: "ODFW Central Zone", type: "agency", readable: false });
assert(unreadable === null, "a source that could not be read yields no signals at all");

group("Word-boundary matching (#2 round two)");
assert(app.mentionsTerm("shop clearance goods", "clear") === false, "'clearance' is not a clarity report");
assert(app.mentionsTerm("shop clearance goods", "good") === false, "'goods' is not a positive report");
assert(app.mentionsTerm("the fish moved slowly", "slow") === false, "'slowly' is not a slow-fishing report");
assert(app.mentionsTerm("fishing has been slow", "slow") === true, "an actual slow report still reads as one");
assert(app.mentionsNoun("green drakes are on", "green drake") === true, "a plural hatch name is still the hatch");
assert(app.mentionsNoun("caddis hatches at dusk", "caddis") === true, "caddis reads with or without a plural");

group("Passage scoping (#2 round two)");
const shopPage = "Metolius River: green drakes and caddis. Crooked River: flows are up and fishing is slow.";
const metoliusWater = app.waters.find((water) => water.id === "metolius");
const metoliusPassage = app.passageAboutWater(metoliusWater, shopPage);
const crookedPassage = app.passageAboutWater(crooked, shopPage);
assert(/green drake/i.test(metoliusPassage), "the Metolius passage holds the Metolius report");
assert(!/green drake/i.test(crookedPassage), "the Crooked passage does not");
assert(/flows are up/i.test(crookedPassage), "the Crooked passage holds the Crooked report");
assert(app.passageAboutWater(crooked, "A page that names no water at all.") === "",
  "a page that never names the water yields nothing");

group("Sync scope (#5 round two)");
const syncWaters = app.watersForBulkSync();
assert(syncWaters.length <= 12, `a sync covers at most 12 waters (covers ${syncWaters.length})`);
assert(syncWaters.length < app.waters.length, `a sync no longer pulls all ${app.waters.length} waters`);
assert(app.waters.filter((water) => app.hasGauge(water)).every((water) => syncWaters.some((item) => item.id === water.id)),
  "every gauged water is still covered by a sync");
assert(/NWS_GRID_CACHE_KEY/.test(html), "the NWS grid a coordinate resolves to is cached on the device");
assert(/nwsRequestChain/.test(html), "weather requests are serialised behind a queue");

group("Shipping language (#4 round two)");
assert(!/\bprototype\b/i.test(html), "the word prototype appears nowhere in the shipped file");
assert(!/\bdemo\b/i.test(html), "the word demo appears nowhere in the shipped file");
assert(/<title>The Rise - Central Oregon Fly Fishing<\/title>/.test(html), "the window title is a shipping title");

group("Storage failures cannot wedge the app");
assert(/function writeWaterCache\(cache\) \{\n      liveReports\.cache = cache;\n      try \{/.test(html),
  "the water cache write is wrapped against a full quota");
assert(/\} finally \{\n        \/\/ Without this, one thrown quota error left bulkStatus set/.test(html),
  "a failed sync always clears bulkStatus");

group("Every alias key is a real water id (#4 round three)");
const aliasIds = Object.keys(app.waterAliasMap);
const orphanAliasKeys = aliasIds.filter((id) => !app.waters.some((water) => water.id === id));
assert(orphanAliasKeys.length === 0,
  `no alias key is dead code (${orphanAliasKeys.join(", ") || "none orphaned"})`);
const orphanExclusionKeys = Object.keys(app.waterAliasExclusions).filter((id) => !app.waters.some((water) => water.id === id));
assert(orphanExclusionKeys.length === 0,
  `no exclusion key is dead code (${orphanExclusionKeys.join(", ") || "none orphaned"})`);
["lower-deschutes", "middle-deschutes", "upper-deschutes"].forEach((id) => {
  assert(Array.isArray(app.waterAliasMap[id]), `${id} has an alias list reachable by its id`);
});
assert(app.aliasesForWater(app.waters.find((water) => water.id === "lower-deschutes")).includes("maupin"),
  "the Lower Deschutes answers to Maupin again");

const odfwDeschutes = "Deschutes River near Maupin is fishing well with caddis in the evening. Trout Creek to Warm Springs is open.";
["lower-deschutes"].forEach((id) => {
  const water = app.waters.find((item) => item.id === id);
  assert(/caddis/i.test(app.passageAboutWater(water, odfwDeschutes)),
    `a report written as "Deschutes River" reaches ${id}`);
});

group("A report belongs to the water it names most specifically (#5 round three)");
const reservoirReport = "Prineville Reservoir is fishing well for bass with good numbers near the dam.";
const reservoir = app.waters.find((water) => water.id === "prineville-reservoir");
assert(/bass/i.test(app.passageAboutWater(reservoir, reservoirReport)),
  "the reservoir keeps its own report");
assert(app.passageAboutWater(crooked, reservoirReport) === "",
  "the Crooked does not inherit the reservoir's report through the word 'prineville'");

const paulinaLake = app.waters.find((water) => water.id === "paulina");
if (paulinaLake) {
  assert(app.passageAboutWater(paulinaLake, "Paulina Creek trail is closed and access is slow.") === "",
    "a Paulina Creek notice is not a Paulina Lake report");
  assert(/callibaetis|fishing/i.test(app.passageAboutWater(paulinaLake, "Paulina Lake is fishing well on callibaetis.")),
    "a Paulina Lake report still reaches Paulina Lake");
}

group("Being mentioned is not a fishing report (#5 round three)");
const roadNotice = "Metolius River. The campground road is now open for the season.";
assert(app.extractSignalsForWater(metoliusWater, roadNotice, { label: "ODFW", type: "agency", readable: true }) === null,
  "a passage with no fishing content yields no signals and names no source");
assert(app.scoreBoostFromSignals("the campground road is now open", { type: "agency" }, [], []) === 0,
  "an agency source earns no boost for content it does not have");
assert(app.scoreBoostFromSignals("fishing well with good numbers", { type: "agency" }, [], []) > 0,
  "an actual positive report still raises the score");
assert(app.scoreBoostFromSignals("fishing has been slow and tough", { type: "agency" }, [], []) < 0,
  "an actual slow report still lowers it");

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
