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
    scrollTop: 0,
    // Nothing here has a layout, so every box is at the origin. Enough for the
    // scroll helpers to run; where a scroll position actually matters it is
    // measured in real Chromium by scripts/test-app-dom.mjs.
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
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
  liveReports, PRO_FEATURES, screenRenderers,
  cueSignalsFromText, passageClauses, reportFreshness, reportAgeHours,
  hoursSince, ageLabel, formatSavedTime, hydrateWaterCache, cacheReport,
  readUserLocation, saveUserLocation, watersSearchState, watersResultsMarkup,
  readingProvenanceWord, loggedReadingLabel, scoreSourceLabel,
  READING_FRESH_HOURS, READING_EXPIRY_HOURS, LOCATION_EXPIRY_HOURS,
  hatchSeasonMonths, hatchProfileFor, hatchProfiles, textFromHtml,
  fetchUsgsReport, localIntelForWater,
  SEASONAL_ACCESS_CLOSURES, ALERT_RULES_KEY, PLANNER_CACHE_KEY,
  setNwsGrid(key, url) { nwsGridCache[key] = url; },
  setPlannerForecasts(value) { plannerForecasts = value; },
  alertRulesNow() { return alertRules; },
  savedWatersNow() { return savedWaterIds; },
  setHomeWaterId(id) { homeWaterId = id; },
  watchPackPostedKeyNow() { return watchPackPostedKey; },
  resetWatchPack() { clearTimeout(watchPackTimer); watchPackTimer = null; watchPackPostedKey = null; },
  watchNoticeNow() { return watchCatchNotice; },
  setEditingLogIndex(index) { editingLogIndex = index; },
  editingLogIndexNow() { return editingLogIndex; },
  setLogStorageUnreadable(value) { logStorageUnreadable = value; },
  WATCH_PACK_DEBOUNCE_MS, WATCH_ACKED_KEY, WATCH_ACKED_MAX, nativeFish,
  BUG_SNAP_TRAITS, SNAP_COLOURS, SNAP_SIZE_BUCKETS, SNAP_SHAPES, SNAP_TAILS,
  ODFW_REGULATIONS, ODFW_REGULATIONS_META, REGULATION_STATUS_LABELS, REGS_CHECK_KEY, REGS_CHECK_URL
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
const sectionIds = [...html.matchAll(/<section id="([a-z-]+)" class="view/g)].map((match) => match[1]);
assert(
  sectionIds.length > 0 && sectionIds.every((id) => id in app.screenRenderers)
    && Object.keys(app.screenRenderers).length === sectionIds.length,
  `every screen section has a registered renderer (${sectionIds.length} sections)`
);
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
assert(/value="\$\{attr\(editingEntry \? editingEntry\.fly \|\| "" : defaultFly\)\}"/.test(html), "the edit form escapes the fly value");

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


/* ================================================================== */
/* Round four                                                          */
/* ================================================================== */

group("A report parser that can read a negative (#6 round four)");
const agency = { label: "ODFW Central Zone", type: "agency", readable: true };
assert(app.scoreBoostFromSignals("fishing has not been good and few fish have been landed.", agency, [], []) < 0,
  "'has not been good' lowers the score instead of raising it");
assert(app.cueSignalsFromText("fishing has not been good and few fish have been landed.")
  .includes("technical human report"),
  "a negated positive is reported as the negative it is");
assert(!app.cueSignalsFromText("fishing has not been good and few fish have been landed.")
  .includes("positive human report"),
  "and never as a positive report");
assert(app.scoreBoostFromSignals("do not expect good numbers until the water warms.", agency, [], []) < 0,
  "'do not expect good numbers' is not a positive report");

const noCaddis = app.extractSignalsForWater(
  app.waters.find((water) => water.id === "crooked"),
  "Crooked River. There is no caddis activity yet; anglers report poor results.",
  agency
);
assert(!(noCaddis?.hatches || []).some((hatch) => /caddis/i.test(hatch)),
  "'there is no caddis activity' does not put caddis on the card");
assert((noCaddis?.scoreBoost ?? 0) < 0, "and the poor results still lower the score");

group("A weather forecast is not a water report (#6 round four)");
const skyText = "Skies will be clear and cold overnight with a good chance of snow.";
assert(!app.cueSignalsFromText(skyText).includes("clear water"),
  "a clear sky is not clear water");
assert(!app.cueSignalsFromText(skyText).includes("positive human report"),
  "a good chance of snow is not a good fishing report");
assert(app.scoreBoostFromSignals(skyText, agency, [], []) === 0,
  "a forecast sentence moves the score by nothing");
assert(app.cueSignalsFromText("the water is clear and fishing well").includes("clear water"),
  "an actual clarity report still registers");

group("Readings expire (#3 round four)");
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
assert(app.reportFreshness({ cachedAt: hoursAgo(1) }) === "fresh", "an hour-old reading is fresh");
assert(app.reportFreshness({ cachedAt: hoursAgo(30) }) === "stale", "a day-old reading is stale, not fresh");
assert(app.reportFreshness({ cachedAt: hoursAgo(24 * 45) }) === "expired", "a 45-day-old reading is expired");
assert(app.reportFreshness({}) === "fresh", "a reading fetched this session has no timestamp and is current");

const deschutes = app.waters.find((water) => water.id === "lower-deschutes");
app.liveReports.byWater[deschutes.id] = {
  status: "ready", fromCache: true, cachedAt: hoursAgo(24 * 45),
  usgs: { flow: "9,340 cfs", waterTemp: "41 F" }, nws: {}
};
assert(app.valueProvenance(deschutes, "flow") === "reference",
  "a 45-day-old gauge reading is not labelled measured");
assert(app.liveDisplayValue(deschutes, "flow") === deschutes.flow,
  "and the water falls back to its own reference value");

app.liveReports.byWater[deschutes.id].cachedAt = hoursAgo(30);
assert(app.valueProvenance(deschutes, "flow") === "stale",
  "a day-old gauge reading is measured, but not current");
assert(app.liveDisplayValue(deschutes, "flow") === "9,340 cfs",
  "a stale reading is still shown - it is real, it is just not from today");
assert(/readings/i.test(app.scoreSourceLabel(deschutes)) && !/live data/i.test(app.scoreSourceLabel(deschutes)),
  `a stale report does not call itself live data (${app.scoreSourceLabel(deschutes)})`);

app.liveReports.byWater[deschutes.id].cachedAt = hoursAgo(1);
assert(app.valueProvenance(deschutes, "flow") === "measured", "a fresh gauge reading is measured");
delete app.liveReports.byWater[deschutes.id];

assert(app.readingProvenanceWord({ flowSource: "stale" }, "flow") === "measured earlier",
  "a catch logged against a stale reading says so");
assert(/\(measured earlier\)/.test(app.loggedReadingLabel({ flow: "9,340 cfs", flowSource: "stale" }, "flow")),
  "and the journal prints it beside the number");

group("A saved reading says how old it is (#3 round four)");
assert(/days ago/.test(app.formatSavedTime(hoursAgo(24 * 45))),
  `a 45-day-old save reports its age (${app.formatSavedTime(hoursAgo(24 * 45))})`);
assert(!/ago/.test(app.formatSavedTime(hoursAgo(2))), "a save from this morning does not");
assert(app.ageLabel(24 * 45) === "45 days ago", "age reads in days once it is past a day");
assert(app.ageLabel(3) === "3h ago", "and in hours before that");

group("An expired cache is dropped at launch (#3 round four)");
localStorage.setItem("riseWaterReports.v1", JSON.stringify({
  version: 1,
  byWater: {
    "lower-deschutes": { cachedAt: hoursAgo(24 * 45), usgs: { flow: "9,340 cfs" }, nws: {} },
    crooked: { cachedAt: hoursAgo(2), usgs: { flow: "235 cfs" }, nws: {} }
  },
  localIntel: { byWater: { crooked: { scoreBoost: .24, sources: ["ODFW"] } }, sources: [], updatedAt: hoursAgo(24 * 45), errors: [] },
  lastSavedAt: hoursAgo(24 * 45),
  lastDailyOpen: ""
}));
delete app.liveReports.byWater["lower-deschutes"];
delete app.liveReports.byWater.crooked;
app.hydrateWaterCache();
assert(!app.liveReports.byWater["lower-deschutes"], "the 45-day-old report is not hydrated");
assert(Boolean(app.liveReports.byWater.crooked), "the two-hour-old report is");
assert(!app.liveReports.cache.byWater["lower-deschutes"], "and it is pruned from the stored cache");
assert(!Object.keys(app.liveReports.cache.localIntel.byWater).length,
  "a 45-day-old local report no longer boosts anything");
delete app.liveReports.byWater.crooked;

group("A stale location is not where the angler is (#round four smaller)");
localStorage.setItem("riseUserLocation.v1", JSON.stringify({
  lat: 39.74, lon: -104.99, updatedAt: hoursAgo(24 * 171)
}));
assert(app.readUserLocation() === null, "a 171-day-old fix is discarded, not used as the current position");
assert(localStorage.getItem("riseUserLocation.v1") === null, "and it is removed from storage");
localStorage.setItem("riseUserLocation.v1", JSON.stringify({
  lat: 44.06, lon: -121.31, updatedAt: hoursAgo(2)
}));
assert(app.readUserLocation() !== null, "a fix from two hours ago is still good");
localStorage.removeItem("riseUserLocation.v1");

// The no-match case needs a real search field; it is asserted in the DOM suite.
group("Waters search state (#7 round four)");
const beforeQuery = app.watersSearchState();
assert(beforeQuery.topWater !== null, "an empty search has a top water");

/* ------------------------------------------------------------------ */
group("A negated list stays negated past the comma (#3 round five)");

function clausesOf(text) {
  return app.passageClauses(text).map((clause) => `${clause.negated ? "NEG " : ""}${clause.text}`);
}

const negatedList = app.passageClauses("there is no caddis, mayfly, or stonefly activity right now");
assert(negatedList.every((clause) => clause.negated),
  `every item of a negated list is negated (${clausesOf("there is no caddis, mayfly, or stonefly activity right now").join(" | ")})`);

const listSource = { readable: true, label: "ODFW Central Zone" };
const listWater = app.waters.find((water) => water.id === "crooked");
const listSignals = app.extractSignalsForWater(
  listWater,
  "Crooked River: there is no caddis, mayfly, or stonefly activity right now.",
  listSource
);
assert(!listSignals || !listSignals.hatches.length,
  `and none of the three insects reaches the card (${JSON.stringify(listSignals?.hatches || [])})`);

// The carry must stop at anything that states something in its own right.
const mixed = app.passageClauses("there is no caddis activity, the water is clear and fishing has been good");
assert(mixed[0].negated, "the negated clause is negated");
assert(!mixed[1].negated,
  `a clause with its own verb does not inherit the negation (${clausesOf("there is no caddis activity, the water is clear and fishing has been good").join(" | ")})`);

// And at a contrastive conjunction, which reverses the sense rather than
// continuing it.
const contrast = app.passageClauses("not much is happening, but the caddis are thick");
assert(contrast[0].negated, "the first half is negated");
assert(!contrast[contrast.length - 1].negated, "and 'but' ends the negation rather than carrying it");

const contrastSignals = app.extractSignalsForWater(
  listWater,
  "Crooked River: not much is happening, but the caddis are thick in the evening.",
  listSource
);
assert(Boolean(contrastSignals) && contrastSignals.hatches.includes("Caddis"),
  `a hatch asserted after 'but' is still read (${JSON.stringify(contrastSignals?.hatches || [])})`);

// A full stop always ends the negation.
const sentences = app.passageClauses("there is no caddis activity. mayflies are hatching");
assert(sentences[0].negated && !sentences[1].negated, "a full stop ends the negation");

/* ------------------------------------------------------------------ */
group("A catch the app could not save does not stay in the journal (#4 round five)");

const realSetItem = localStorage.setItem.bind(localStorage);
app.setLogs([{ ...app.normalizeLogEntry({ fly: "KEEP-ME", loggedAt: "2026-04-02T12:00:00.000Z" }) }]);
const beforeFailedWrite = JSON.stringify(app.getLogs());
localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
const wrote = app.setLogs([
  app.normalizeLogEntry({ fly: "LOST", loggedAt: "2026-04-03T12:00:00.000Z" }),
  ...app.getLogs()
]);
localStorage.setItem = realSetItem;
assert(wrote === false, "a write with nowhere to go reports failure");
assert(JSON.stringify(app.getLogs()) === beforeFailedWrite,
  `and the journal is unchanged in memory too (${app.getLogs().map((entry) => entry.fly).join(", ")})`);
localStorage.removeItem("riseLogs");

/* ------------------------------------------------------------------ */
group("Caddis is in season from April, not just in the fall (#1 round six)");

assert(app.hatchSeasonMonths("Caddis").join(",") === "4,5,6,7,8,9,10",
  `"Caddis" keeps the Tan Caddis season (${app.hatchSeasonMonths("Caddis")})`);
assert(app.hatchSeasonMonths("October Caddis").join(",") === "9,10,11",
  `"October Caddis" keeps its own (${app.hatchSeasonMonths("October Caddis")})`);
assert(app.hatchProfileFor("Dragonfly") === app.hatchProfiles.damsel, "a dragonfly hatch is not given the caddis box");

/* ------------------------------------------------------------------ */
group("ODFW is credited only with what it said (#2 round six)");

assert(app.waterAppropriateHatches([], app.waters[0], { fallback: false }).length === 0,
  "an empty source list gets no year-round filler");
const intelWater = app.waters.find((water) => water.type !== "Lake");
app.liveReports.cache = { localIntel: { byWater: { [intelWater.id]: { hatches: [], flies: [], cues: ["clear water"], sources: ["ODFW Central Zone"], scoreBoost: 0 } } } };
assert(app.localIntelForWater(intelWater).hatches.length === 0,
  `a cues-only passage credits ODFW with no hatches (${app.localIntelForWater(intelWater).hatches.join(", ")})`);
app.liveReports.cache = null;

/* ------------------------------------------------------------------ */
group("A gauge with no data is not a measurement (#3 round six)");

{
  const series = (code, value, dateTime) => ({
    variable: { variableCode: [{ value: code }], noDataValue: -999999 },
    values: [{ value: [{ value, dateTime }] }]
  });
  const now = new Date().toISOString();
  const weeksAgo = new Date(Date.now() - 21 * 86400000).toISOString();
  const realFetch = context.fetchJsonWithTimeout;
  context.fetchJsonWithTimeout = async () => ({ value: { timeSeries: [series("00060", "-999999", now), series("00010", "-999999", now)] } });
  const iced = await app.fetchUsgsReport({ usgs: "14087400" }).then(() => "resolved", (error) => error.message);
  assert(/no current readings/.test(iced), `an iced gauge is a failed read, not an empty success (${iced})`);
  context.fetchJsonWithTimeout = async () => ({ value: { timeSeries: [series("00060", "4160", now), series("00010", "12", weeksAgo)] } });
  const mixed = await app.fetchUsgsReport({ usgs: "14087400" });
  assert(mixed.flow === "4,160 cfs" && app.flowFromText(mixed.flow) === 4160, `flow round-trips in any locale (${mixed.flow})`);
  assert(mixed.waterTemp === null, `a three-week-old temperature is not current (${mixed.waterTemp})`);
  context.fetchJsonWithTimeout = realFetch;
}

/* ------------------------------------------------------------------ */
group("Report text is read the way it was written (#4 round six)");

{
  const decoded = app.textFromHtml("<p>Fishing has not been&nbsp;good. It isn&rsquo;t fishing well &amp; there is no&nbsp;caddis yet.</p>");
  assert(!/&\w+;/.test(decoded), `entities are decoded (${decoded})`);
  const clauses = app.passageClauses(decoded);
  assert(clauses.every((clause) => clause.negated), `an entity does not split a negated clause (${JSON.stringify(clauses)})`);
  assert(!app.passageClauses("fishing has been good with a few larger fish caught.")[0].negated, "\"a few\" is not a negation");
  assert(app.passageClauses("few fish caught this week.")[0].negated, "\"few\" still is");
  assert(app.mentionsNoun("stoneflies are out", "stonefly"), "stoneflies is the plural of stonefly");
}

group("Stored payload validation preserves valid legacy data");
{
  const waterId = app.waters[0].id;
  const cachedAt = new Date().toISOString();
  localStorage.setItem("riseWaterReports.v1", JSON.stringify({
    byWater: { [waterId]: { cachedAt, usgs: { flow: "235 cfs", waterTemp: "54 F" }, nws: { forecast: "Sunny", wind: "5 mph" }, errors: [] }, broken: null },
    localIntel: { byWater: { [waterId]: { hatches: ["Caddis"], sources: ["ODFW"], scoreBoost: .2 } }, sources: [], errors: [], updatedAt: cachedAt }
  }));
  const cache = context.readWaterCache();
  assert(cache.byWater[waterId].usgs.flow === "235 cfs" && cache.byWater[waterId].cachedAt === cachedAt,
    "valid cached measurements retain their value and original age");
  assert(cache.localIntel.byWater[waterId].hatches[0] === "Caddis" && cache.localIntel.byWater[waterId].flies.length === 0,
    "older optional intel fields receive safe defaults without discarding real signals");
  assert(!cache.byWater.broken, "unknown malformed water records are not hydrated");
  assert(context.parseLogPayload(JSON.stringify([{ fly: "legacy" }])).logs[0].dateApproximate,
    "valid legacy journal arrays remain restorable without inventing dates");
  assert(context.parseLogPayload(JSON.stringify({ savedAt: cachedAt, logs: [] })).logs.length === 0,
    "a legitimate empty journal envelope is not corruption");
  assert(context.parseLogPayload(JSON.stringify({ savedAt: cachedAt, logs: [null] })) === null,
    "invalid backup rows reject the payload rather than silently deleting records");
  localStorage.removeItem("riseWaterReports.v1");
}


/* ------------------------------------------------------------------ */
group("Audit 2026-11-18: flies are held to their insect's season");
{
  const lower = app.waters.find((water) => water.id === "lower-deschutes");
  const metolius = app.waters.find((water) => water.id === "metolius");
  const davis = app.waters.find((water) => water.id === "davis");
  assert(context.flyInSeason("PMD Sparkle Dun #16", 1) === false, "a PMD dry is out of season in January");
  assert(context.flyInSeason("Zebra Midge #20", 1) === true, "a midge is fishable in January");
  assert(context.flyInSeason("Pat's Rubber Legs #8", 1) === true, "an attractor that imitates no seasonal insect is allowed");
  const realMonth = context.currentMonth;
  context.currentMonth = () => 1;
  const saved = { ...app.liveReports.byWater };
  Object.keys(app.liveReports.byWater).forEach((key) => delete app.liveReports.byWater[key]);
  const januaryLower = context.liveRecommendedFlies(lower);
  const januaryMetolius = context.liveRecommendedFlies(metolius);
  const januaryDavis = context.liveRecommendedFlies(davis);
  context.currentMonth = realMonth;
  Object.assign(app.liveReports.byWater, saved);
  assert(!januaryLower.some((fly) => /pmd|yellow sally|caddis/i.test(fly)),
    `no summer fly on the Lower Deschutes in January (${januaryLower.join(", ")})`);
  assert(januaryLower.length > 0, "the January box is not left empty");
  assert(!januaryMetolius.some((fly) => /green drake/i.test(fly)), `no Green Drake in January (${januaryMetolius.join(", ")})`);
  assert(!januaryDavis.some((fly) => /damsel|callibaetis/i.test(fly)),
    `an unmeasured lake is not given summer flies from its reference temperature (${januaryDavis.join(", ")})`);
}

group("Audit 2026-11-18: reports land on the water they describe");
{
  const crooked = app.waters.find((water) => water.id === "crooked");
  const metolius = app.waters.find((water) => water.id === "metolius");
  const source = { label: "ODFW", type: "agency", readable: true };
  const page = app.textFromHtml("<h3>Crooked River</h3><p>Fishing is slow and flows are high</p><h3>Metolius River</h3><p>Fishing has been good with green drakes.</p>");
  assert(/\n/.test(page), "headings and paragraphs keep their boundaries");
  const pageMetolius = app.extractSignalsForWater(metolius, page, source);
  const pageCrooked = app.extractSignalsForWater(crooked, page, source);
  assert(pageMetolius?.hatches.includes("Green Drake"), "the Metolius section's green drakes reach the Metolius");
  assert(!pageCrooked?.hatches.includes("Green Drake"), "and not the Crooked");
  assert(pageCrooked?.scoreBoost < 0, `the Crooked keeps its own slow report (${pageCrooked?.scoreBoost})`);
  const sentence = "Anglers who found the Crooked River too high moved to the Metolius, where fishing has been good on green drakes.";
  const sentenceMetolius = app.extractSignalsForWater(metolius, sentence, source);
  const sentenceCrooked = app.extractSignalsForWater(crooked, sentence, source);
  assert(sentenceMetolius?.hatches.includes("Green Drake") && sentenceMetolius.scoreBoost > 0,
    "one sentence naming two waters credits each with its own part");
  assert(!sentenceCrooked || !sentenceCrooked.hatches.includes("Green Drake"), "a longer name does not take the other water's report");
}

group("Audit 2026-11-18: a negation denies what follows it");
{
  const metolius = app.waters.find((water) => water.id === "metolius");
  const source = { label: "ODFW", type: "agency", readable: true };
  assert(app.cueSignalsFromText("fishing is good with no crowds").includes("positive human report"),
    "\"good with no crowds\" is a good report");
  assert(app.scoreBoostFromSignals("fishing has been good without much pressure", source, [], []) > 0,
    "\"good without much pressure\" raises the score");
  assert(app.scoreBoostFromSignals("fishing has not been good", source, [], []) < 0, "\"not been good\" still lowers it");
  const wind = app.extractSignalsForWater(metolius, "Metolius River: caddis are hatching in the evenings with no wind.", source);
  assert(wind?.hatches.includes("Caddis"), "\"caddis ... with no wind\" keeps the caddis");
  assert(wind?.cues.includes("evening window"), "\"evenings\" is the evening window");
  const none = app.extractSignalsForWater(metolius, "Metolius River: there is no caddis, mayfly, or stonefly activity yet.", source);
  assert(!none?.hatches.includes("Caddis"), "a denied list is still denied");
}

group("Audit 2026-11-18: names are not cues, and a hatch is counted once");
{
  const clearLake = app.waters.find((water) => water.id === "clear-lake");
  const lower = app.waters.find((water) => water.id === "lower-deschutes");
  const source = { label: "ODFW", type: "agency", readable: true };
  assert(app.extractSignalsForWater(clearLake, "Clear Lake: the campground road is now open for the season.", source) === null,
    "\"Clear Lake\" in a road notice is not a clear-water report");
  const realMonth = context.currentMonth;
  context.currentMonth = () => 11;
  const october = app.extractSignalsForWater(lower, "Lower Deschutes: October caddis hatching in the afternoons near Maupin.", source);
  context.currentMonth = realMonth;
  assert(october?.hatches.join(",") === "October Caddis", `October caddis is not also a generic Caddis (${october?.hatches.join(",")})`);
}

group("Audit 2026-11-18: readings keep their real age");
{
  const crooked = app.waters.find((water) => water.id === "crooked");
  const realUsgs = context.fetchUsgsReport;
  const realNws = context.fetchNwsReport;
  const elevenHoursAgo = new Date(Date.now() - 11 * 3600000).toISOString();
  const previous = {
    status: "ready", cachedAt: elevenHoursAgo, meta: context.liveMetaFor(crooked),
    usgs: { flow: "240 cfs", waterTemp: "52 F", observedAt: elevenHoursAgo }, nws: { wind: "5 mph W" }
  };
  app.liveReports.byWater.crooked = previous;
  const samplesBefore = context.flowHistoryFor("crooked").length;
  context.fetchUsgsReport = async () => { throw new Error("USGS timeout"); };
  context.fetchNwsReport = async () => ({ air: "60 F", wind: "6 mph W", forecast: "Sunny", observedAt: null, url: "" });
  const ok = await context.refreshLiveReportOnce(crooked, { render: false });
  const carried = app.liveReports.byWater.crooked;
  assert(ok && carried.usgs?.flow === "240 cfs", "a weather-only refresh keeps the fresh gauge reading");
  assert(carried.cachedAt === elevenHoursAgo, `and keeps its age rather than re-stamping it (${carried.cachedAt})`);
  assert(context.flowHistoryFor("crooked").length === samplesBefore, "a carried reading is not recorded as a new day of history");
  app.liveReports.byWater.crooked = { ...carried, cachedAt: new Date(Date.now() - 13 * 3600000).toISOString() };
  await context.refreshLiveReportOnce(crooked, { render: false });
  assert(!app.liveReports.byWater.crooked.usgs, "once that age passes the fresh window it is no longer carried");
  context.fetchUsgsReport = realUsgs;
  context.fetchNwsReport = realNws;
  delete app.liveReports.byWater.crooked;

  const expiredAt = new Date(Date.now() - 9 * 86400000).toISOString();
  app.liveReports.byWater.crooked = { status: "ready", cachedAt: expiredAt, usgs: { flow: "600 cfs" } };
  assert(app.flowRatioFor(crooked) === null, "an expired reading does not drive the flow wording");
  delete app.liveReports.byWater.crooked;
}

group("Audit 2026-11-18: a failed page keeps its last good reading");
{
  const metolius = app.waters.find((water) => water.id === "metolius");
  const realText = context.fetchTextWithTimeout;
  const savedCache = app.liveReports.cache;
  app.liveReports.cache = null;
  const realMonth = context.currentMonth;
  context.currentMonth = () => 6;
  const filler = " The Central Zone covers lakes, reservoirs and rivers across the region for anglers.";
  context.fetchTextWithTimeout = async (url) => url.includes("recreation-report")
    ? `<p>Metolius River: fishing has been good with green drakes.${filler}</p>`
    : `<p>General regulations and seasons apply.${filler}</p>`;
  await context.scrubLocalResources("manual");
  assert(context.localIntelForWater(metolius).hatches.includes("Green Drake"), "day one reads the weekly report");
  context.fetchTextWithTimeout = async (url) => {
    if (url.includes("recreation-report")) throw new Error("ODFW timeout");
    return `<p>General regulations and seasons apply.${filler}</p>`;
  };
  await context.scrubLocalResources("manual");
  assert(context.localIntelForWater(metolius).hatches.includes("Green Drake"),
    "a weekly report that times out the next day does not erase what it said");
  context.fetchTextWithTimeout = realText;
  context.currentMonth = realMonth;
  app.liveReports.cache = savedCache;
}

group("Audit 2026-11-18: smaller honesty fixes");
{
  const crooked = app.waters.find((water) => water.id === "crooked");
  const realHour = context.currentHour;
  const window = app.primeWindowHours(crooked);
  if (window) {
    context.currentHour = () => window[1];
    assert(app.timeOfDayFit(crooked) < 1, `the hour after the window closes is not full credit (${app.timeOfDayFit(crooked)})`);
    context.currentHour = realHour;
  }
  const hosmer = app.waters.find((water) => water.id === "hosmer");
  const temp = context.scoreBreakdownItems(hosmer).find(([label]) => label === "Water temp");
  assert(/not measured/i.test(temp[2]), `an unmeasured temperature is not explained as a score factor (${temp[2]})`);
  assert(JSON.stringify(context.hookSizeRange("#16-22")) === "[16,22]", "a size range is read whole");
  assert(context.sizeRangesOverlap(context.hookSizeRange("#16-22"), [18, 26]), "a #16-22 BWO is a tiny bug");
  assert(!context.sizeRangesOverlap(context.hookSizeRange("#4-10"), [18, 26]), "a #4-10 streamer is not");
  assert(!/<small>▲ 2° since dawn<\/small>/.test(html) && !/<em>AI-matched<\/em>/.test(html), "Today prints no invented trend or AI claim");
  assert(/`\\uFEFF\$\{logCsv\(\)\}`/.test(html), "the CSV export carries a UTF-8 byte-order mark");

  const savedCache = app.liveReports.cache;
  app.liveReports.cache = { ...context.emptyWaterCache(), localIntel: { byWater: { crooked: { hatches: ["BWO"], flies: [], cues: [], sources: ["ODFW"], scoreBoost: .2 } }, sources: [], updatedAt: new Date().toISOString(), errors: [] } };
  context.markDailyOpenSyncComplete();
  assert(app.liveReports.cache.localIntel.byWater.crooked, "marking the day synced does not reload over the in-memory intel");
  app.liveReports.cache = savedCache;
}

group("Plan the week: day scores from forecast weather and season");
{
  const metolius = app.waters.find((water) => water.id === "metolius");
  const hosmer = app.waters.find((water) => water.id === "hosmer");
  assert(context.dailyForecastUrlFrom("https://api.weather.gov/gridpoints/PDT/40,40/forecast/hourly") === "https://api.weather.gov/gridpoints/PDT/40,40/forecast",
    "the daily forecast URL is the cached hourly URL without /hourly");
  assert(context.dailyForecastUrlFrom("https://api.weather.gov/gridpoints/PDT/40,40/forecast") === "https://api.weather.gov/gridpoints/PDT/40,40/forecast",
    "a cached daily URL is used as it is");
  assert(context.dailyForecastUrlFrom("https://evil.example/gridpoints/PDT/40,40/forecast") === null, "only api.weather.gov grids are accepted");
  assert(context.windMphFromText("5 to 10 mph") === 10, "a wind range is planned on its top end");
  assert(context.windMphFromText("15 mph") === 15, "a single wind speed is read");
  assert(context.windMphFromText("") === null, "a missing wind is unknown, not calm");

  const periods = [
    { name: "Tonight", startTime: "2026-06-19T18:00:00-07:00", isDaytime: false, temperature: 40, windSpeed: "5 mph", shortForecast: "Clear" },
    ...Array.from({ length: 9 }, (unused, index) => ({
      name: `Day ${index}`,
      startTime: `2026-06-${String(20 + index).padStart(2, "0")}T06:00:00-07:00`,
      isDaytime: true,
      temperature: 70,
      temperatureUnit: "F",
      windSpeed: "5 to 10 mph",
      shortForecast: index === 0 ? "Mostly Cloudy <b>x</b>" : "Sunny",
      probabilityOfPrecipitation: { value: null }
    }))
  ];
  const days = context.plannerDaysFromForecast({ properties: { periods } });
  assert(days.length === 7, `seven daytime periods are kept, nights and the eighth day dropped (${days.length})`);
  assert(days[0].date === "2026-06-20" && days[0].windMph === 10 && days[0].highF === 70, "a period becomes a dated day with wind and high");
  assert(!/[<>]/.test(days[0].forecast), "forecast text is sanitised where it enters the app");
  assert(days[0].precipitation === null, "a null precipitation chance stays unknown");
  assert(context.plannerDaysFromForecast({}).length === 0, "an empty response is no forecast, not seven blank days");

  const base = { date: "2026-06-20", highF: 65, windMph: 8, forecast: "Sunny" };
  const sunny = context.plannerDayScore(metolius, base);
  const cloudy = context.plannerDayScore(metolius, { ...base, forecast: "Mostly Cloudy" });
  const storm = context.plannerDayScore(metolius, { ...base, forecast: "Chance Thunderstorms" });
  const heavy = context.plannerDayScore(metolius, { ...base, forecast: "Heavy Rain" });
  assert(cloudy > sunny, `overcast lifts a day (${sunny} -> ${cloudy})`);
  assert(storm < sunny && heavy < sunny, `thunder and heavy rain lower it (${storm}, ${heavy})`);
  const calmLake = context.plannerDayScore(hosmer, { ...base, windMph: 8 });
  const windyLake = context.plannerDayScore(hosmer, { ...base, windMph: 25 });
  assert(windyLake < calmLake, `a 25 mph day scores below a light-wind day on a lake (${windyLake} < ${calmLake})`);
  const frozen = context.plannerDayScore(metolius, { ...base, highF: 28 });
  assert(frozen < sunny, `a high below freezing lowers the day (${frozen})`);
  const june = context.plannerDayScore(metolius, base);
  const january = context.plannerDayScore(metolius, { ...base, date: "2026-01-20" });
  assert(june > january, `the same weather scores higher in Green Drake season than in January (${june} > ${january})`);
  const scores = [sunny, cloudy, storm, heavy, calmLake, windyLake, frozen, january];
  assert(scores.every((score) => score >= 1 && score <= 10), "every day score is clamped to 1-10");
  const reason = context.plannerDayReason(metolius, { ...base, forecast: "Mostly Cloudy", windMph: 8 });
  assert(/mostly cloudy/.test(reason) && /season/.test(reason) && /light wind/.test(reason), `the reason names sky, season and wind (${reason})`);
  assert(!/cfs|water temp/i.test(reason), "the reason invents no flow or water temperature");
}

group("Plan the week: typical seasonal closures");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const closureIds = app.SEASONAL_ACCESS_CLOSURES.flatMap((closure) => closure.waters);
  assert(closureIds.every((id) => water(id)), `every water in the closure table exists (${closureIds.filter((id) => !water(id)).join(", ") || "all found"})`);
  for (const id of ["spark-lake", "devils", "elk-lake", "hosmer", "lava", "little-lava", "cultus", "little-cultus", "crane-prairie", "todd-lake"]) {
    assert(context.seasonalClosureFor(water(id), "2026-01-10")?.id === "cascade-lakes-highway", `${id} is typically cut off by OR-46 in January`);
  }
  assert(context.seasonalClosureFor(water("hosmer"), "2026-11-14") === null, "OR-46 lakes are open the day before the window");
  assert(context.seasonalClosureFor(water("hosmer"), "2026-11-15") !== null, "and typically closed from mid-November");
  assert(context.seasonalClosureFor(water("hosmer"), "2026-05-25") !== null, "still closed on May 25");
  assert(context.seasonalClosureFor(water("hosmer"), "2026-05-26") === null, "open again after late May");
  assert(context.seasonalClosureFor(water("hosmer"), "2026-07-04") === null, "open in July");
  assert(context.seasonalClosureFor(water("three-creek"), "2026-06-15") !== null, "Three Creek Lake is typically snowbound into June");
  assert(context.seasonalClosureFor(water("ollalie"), "2026-02-01") !== null, "Olallie is typically snowbound in winter");
  assert(context.seasonalClosureFor(water("metolius"), "2026-01-10") === null, "a low-elevation river is never marked snowed in");
  assert(context.seasonalClosureFor(water("hosmer"), "not-a-date") === null, "a malformed date closes nothing");
  assert(app.SEASONAL_ACCESS_CLOSURES.every((closure) => /typically/i.test(closure.typical)), "every closure is worded as typical, not authoritative");
  assert(/tripcheck\.com/.test(html) && /Typically snowed in - check ODOT TripCheck \/ USFS/.test(html), "closed days point at TripCheck and USFS");

  const hourly = "https://api.weather.gov/gridpoints/PDT/23,40/forecast/hourly";
  const coords = app.waterCoordinates.hosmer;
  app.setNwsGrid(`${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`, hourly);
  const forecastDays = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"].map((date) => ({ date, highF: 45, windMph: 6, forecast: "Cloudy" }));
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/23,40/forecast": { fetchedAt: new Date().toISOString(), days: forecastDays } });
  const plan = context.plannerForWater(water("hosmer"), "2026-11-13");
  assert(plan.days.length === 4, `the cached forecast is planned (${plan.days.length} days)`);
  assert(plan.days[0].score !== null && plan.days[1].score !== null, "days before the window are scored");
  assert(plan.days[2].score === null && plan.days[2].reason.startsWith("Typically snowed in"), "a day inside the window is not scored as fishable");
  assert(plan.best && plan.best.date <= "2026-11-14", `the best day is never a snowed-in day (${plan.best?.date})`);
  const later = context.plannerForWater(water("hosmer"), "2026-11-15");
  assert(later.days.length === 2 && later.best === null, "past days drop off, and an all-closed week has no best day");
  app.setPlannerForecasts({});
  assert(context.plannerForWater(water("hosmer")).days.length === 0, "with no forecast nothing is invented");
}

group("Alerts: rules persist on the device and reach the container");
{
  localStorage.removeItem(app.ALERT_RULES_KEY);
  const normalized = context.normalizeAlertRules({
    "lower-deschutes": { flow: { enabled: true, min: "3000", max: 5200 }, greatDay: { enabled: true, threshold: 12 } },
    hosmer: { flow: { enabled: true, min: 1, max: 2 }, greatDay: { enabled: false, threshold: 7.3 } },
    "not-a-water": { flow: { enabled: true, min: 1, max: 2 } }
  });
  assert(!normalized["not-a-water"], "a rule for an unknown water is dropped");
  assert(normalized["lower-deschutes"].flow.min === 3000 && normalized["lower-deschutes"].flow.enabled, "a gauged water keeps its flow range");
  assert(normalized["lower-deschutes"].greatDay.threshold === 10, "a threshold is clamped to the 1-10 scale");
  assert(normalized.hosmer.flow.enabled === false, "a water with no gauge cannot hold a flow alert");
  assert(normalized.hosmer.greatDay.threshold === 7.5, "a threshold is kept to half points");

  const range = context.defaultFlowRange(app.waters.find((item) => item.id === "crooked"));
  assert(range.min === Math.round(235 * .75) && range.max === Math.round(235 * 1.35), `the starting range is the score's near-reference band (${range.min}-${range.max})`);

  if (!app.savedWatersNow().includes("crooked")) context.toggleSavedWater("crooked");
  if (!app.savedWatersNow().includes("hosmer")) context.toggleSavedWater("hosmer");
  context.toggleAlert("crooked", "flow");
  const stored = JSON.parse(localStorage.getItem(app.ALERT_RULES_KEY));
  assert(stored.crooked?.flow?.enabled === true, "turning an alert on writes it to localStorage");
  context.setAlertField("crooked", "flowMin", "180");
  context.setAlertField("crooked", "flowMax", "320");
  const native = context.alertRulesForNative();
  const crookedRule = native.find((rule) => rule.waterId === "crooked");
  assert(crookedRule && crookedRule.site === "14080500" && crookedRule.waterName === "Crooked River"
    && crookedRule.flow.min === 180 && crookedRule.flow.max === 320 && crookedRule.greatDay === null,
    `the container is sent site id, water name and range (${JSON.stringify(crookedRule)})`);
  context.setAlertField("crooked", "flowMin", "400");
  assert(context.alertRulesForNative().find((rule) => rule.waterId === "crooked") === undefined,
    "a minimum above the maximum sends no flow rule rather than an impossible one");
  context.setAlertField("crooked", "flowMin", "180");
  context.toggleAlert("hosmer", "flow");
  assert(app.alertRulesNow().hosmer?.flow?.enabled !== true, "the flow toggle does nothing on a water with no gauge");
  context.toggleAlert("hosmer", "greatDay");
  assert(context.alertRulesForNative().some((rule) => rule.waterId === "hosmer" && rule.greatDay?.threshold === 8),
    "a great-day alert defaults to a threshold of 8");
  context.toggleAlert("metolius", "flow");
  assert(!app.alertRulesNow().metolius, "a water that is not saved cannot hold an alert");

  context.toggleSavedWater("crooked");
  assert(!app.alertRulesNow().crooked && !JSON.parse(localStorage.getItem(app.ALERT_RULES_KEY)).crooked,
    "unsaving a water removes its alert from memory and storage");
  context.toggleSavedWater("hosmer");
  assert(Object.keys(app.alertRulesNow()).length === 0, "no alert outlives its saved water");
}

group("Alerts: great-day schedule");
{
  if (!app.savedWatersNow().includes("metolius")) context.toggleSavedWater("metolius");
  context.toggleAlert("metolius", "greatDay");
  context.setAlertField("metolius", "threshold", "6");
  const today = context.pacificDateKey();
  const addDays = (count) => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
  };
  const coords = app.waterCoordinates.metolius;
  app.setNwsGrid(`${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`, "https://api.weather.gov/gridpoints/PDT/30,60/forecast/hourly");
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/30,60/forecast": {
    fetchedAt: new Date().toISOString(),
    days: [0, 1, 2].map((offset) => ({ date: addDays(offset), highF: 55, windMph: 8, forecast: "Cloudy" }))
  } });
  const schedule = context.greatDaySchedule(today);
  const entry = schedule.find((item) => item.waterId === "metolius");
  assert(entry && entry.threshold === 6 && entry.waterName === "Metolius", "a great-day water is scheduled with its threshold");
  assert(entry && entry.days.length === 2 && entry.days.every((day) => day.date > today && day.score >= 6 && typeof day.reason === "string" && day.label),
    `only future days at or above the threshold are sent, each with its reason (${entry?.days.length})`);
  context.setAlertField("metolius", "threshold", "9.5");
  assert(context.greatDaySchedule(today).find((item) => item.waterId === "metolius")?.days.length === 0,
    "a threshold nothing reaches sends an empty list, which clears stale notifications");
  app.setPlannerForecasts({});
  assert(context.greatDaySchedule(today).length === 0, "a water with no forecast is left out rather than cleared");
  context.toggleSavedWater("metolius");
  assert(app.PRO_FEATURES.every(([title, body]) => !/week|planner|alert|notif/i.test(`${title} ${body}`)), "the planner and alerts are free, not Pro features");
}

group("Feature 5: Snap a bug is photo-assisted, never photo-recognised");
{
  // The colour classifier, on colours whose names nobody disputes.
  const cases = [
    [[85, 107, 47], "olive", "olive drab"],
    [[128, 128, 0], "olive", "olive"],
    [[34, 139, 34], "olive", "forest green"],
    [[210, 180, 140], "tan", "tan"],
    [[139, 69, 19], "tan", "saddle brown"],
    [[255, 140, 0], "tan", "dark orange (October caddis)"],
    [[20, 20, 20], "black", "near black"],
    [[60, 55, 50], "black", "dark grey-brown"],
    [[255, 253, 208], "yellow", "cream"],
    [[240, 220, 60], "yellow", "yellow"],
    [[178, 34, 34], "red", "firebrick"],
    [[128, 0, 32], "red", "maroon"],
    [[60, 120, 200], "blue", "blue"],
    [[64, 180, 170], "blue", "blue-green (adult damsel)"],
    [[128, 128, 128], "grey", "mid grey"],
    [[192, 192, 192], "grey", "silver"]
  ];
  for (const [[r, g, b], expected, name] of cases) {
    const got = context.classifyBugColour({ r, g, b });
    assert(got === expected, `${name} rgb(${r},${g},${b}) reads as ${expected} (${got})`);
  }
  const colourKeys = app.SNAP_COLOURS.map(([key]) => key);
  for (const key of ["olive", "tan", "black", "yellow"]) {
    assert(colourKeys.includes(key), `the photo colours keep the assistant's "${key}" key`);
  }

  // Coverage: every bug has every trait, and every value is a real option.
  assert(context.bugsMissingSnapTraits().length === 0,
    `every bug has Snap a bug traits (${context.bugsMissingSnapTraits().join(", ") || "none missing"})`);
  assert(Object.keys(app.BUG_SNAP_TRAITS).every((id) => app.bugs.some((bug) => bug.id === id)),
    "the trait table names no bug that is not in the library");
  const shapeKeys = app.SNAP_SHAPES.map(([key]) => key);
  const tailKeys = app.SNAP_TAILS.map(([key]) => key);
  const unknown = Object.entries(app.BUG_SNAP_TRAITS).flatMap(([id, traits]) => [
    ...traits.colors.filter((value) => !colourKeys.includes(value)),
    ...traits.shapes.filter((value) => !shapeKeys.includes(value)),
    ...traits.tails.filter((value) => !tailKeys.includes(value))
  ].map((value) => `${id}:${value}`));
  assert(!unknown.length, `every trait value is an option the angler can pick (${unknown.join(", ") || "all valid"})`);
  const used = new Set(Object.values(app.BUG_SNAP_TRAITS).flatMap((traits) => [...traits.colors, ...traits.shapes, ...traits.tails]));
  const unreachable = [...colourKeys, ...shapeKeys, ...tailKeys].filter((value) => !used.has(value));
  assert(!unreachable.length, `every option matches at least one bug (${unreachable.join(", ") || "none dead"})`);
  for (const bucket of app.SNAP_SIZE_BUCKETS) {
    assert(app.bugs.some((bug) => context.sizeRangesOverlap(context.hookSizeRange(bug.sizes), bucket.range)),
      `size ${bucket.label} matches at least one bug`);
  }

  // Scoring on traits.
  const none = { month: 11, waterName: "Test water", predictedBugIds: [] };
  const bwo = context.snapBugResults({ color: "olive", size: "s20", shape: "upright", tails: "2" }, none);
  assert(bwo[0]?.bug.id === "bwo", `an olive #20 upright-winged two-tailed bug is a BWO first (${bwo.map((r) => r.bug.id)})`);
  assert(context.snapConfidenceLabel(bwo[0]) === "Strong match on 4 of 4 traits", `and is a strong match (${context.snapConfidenceLabel(bwo[0])})`);
  assert(bwo.length <= 3, "no more than three results");
  assert(bwo.every((result) => result.matched.length * 2 >= result.answered), "every result matches at least half the traits");
  const stone = context.snapBugResults({ color: "black", size: "big", shape: "flat", tails: "2" }, none);
  assert(stone[0]?.bug.id === "stonefly", `a big dark flat-winged two-tailed bug is a stonefly (${stone.map((r) => r.bug.id)})`);
  assert(context.snapBugTraitLabel(app.bugs.find((bug) => bug.id === "stonefly"), "tails") === "2 tails",
    "a missed trait is explained with what the bug actually has");
  assert(context.snapConfidenceLabel({ matched: ["color", "size"], answered: 2 }) === "Possible match on 2 of 2 traits",
    "two traits cannot make a strong match however well they agree");
  assert(context.snapConfidenceLabel({ matched: ["color", "size", "shape"], answered: 4 }) === "Strong match on 3 of 4 traits",
    "three of four is strong");
  assert(context.snapConfidenceLabel({ matched: ["color", "size"], answered: 4 }) === "Possible match on 2 of 4 traits",
    "two of four is only possible");

  // Priors reorder a tie, explain themselves, and never beat a trait.
  const tent = { shape: "tent", tails: "none" };
  const june = context.snapBugResults(tent, { month: 6, waterName: "Test water", predictedBugIds: [] });
  assert(june[0]?.bug.id === "caddis", `in June the in-season Tan Caddis outranks the October Caddis (${june.map((r) => r.bug.id)})`);
  assert(june.find((r) => r.bug.id === "october-caddis")?.prior.reasons.some((reason) => /Out of season in Jun.*not ruled out/.test(reason)),
    "and the October Caddis says it is out of season, not excluded");
  const november = context.snapBugResults(tent, { month: 11, waterName: "Test water", predictedBugIds: [] });
  assert(november[0]?.bug.id === "october-caddis", `in November the order flips (${november.map((r) => r.bug.id)})`);
  const octoberTie = context.snapBugResults(tent, { month: 10, waterName: "Test water", predictedBugIds: [] });
  const octoberOnWater = context.snapBugResults(tent, { month: 10, waterName: "Lower Deschutes", predictedBugIds: ["caddis"] });
  assert(octoberTie[0]?.bug.id === "october-caddis" && octoberOnWater[0]?.bug.id === "caddis",
    `being on the water's predicted list breaks a tie (${octoberTie[0]?.bug.id} -> ${octoberOnWater[0]?.bug.id})`);
  assert(octoberOnWater[0].prior.reasons.some((reason) => /predicted hatch list for Lower Deschutes/.test(reason)),
    "and the boost names the water");
  const damselInJanuary = context.snapBugResults({ color: "blue", shape: "long", tails: "3" }, { month: 1, waterName: "Test water", predictedBugIds: [] });
  assert(damselInJanuary[0]?.bug.id === "damsel", "an out-of-season bug that matches every trait still comes first");
  const everyBug = app.bugs.map((bug) => bug.id);
  const boosted = context.snapBugResults({ color: "blue", shape: "long", tails: "3" }, { month: 7, waterName: "Test water", predictedBugIds: everyBug });
  assert(boosted.every((result) => result.matched.length >= 2), "priors never promote a bug the traits do not support");
  const lowerDeschutes = app.waters.find((water) => water.id === "lower-deschutes") || app.waters[0];
  const liveContext = context.snapPriorContext(6, lowerDeschutes);
  assert(liveContext.predictedBugIds.length > 0 && liveContext.predictedBugIds.every((id) => app.bugs.some((bug) => bug.id === id)),
    `the water's predicted hatches resolve to bugs in the library (${liveContext.predictedBugIds.join(", ")})`);

  // Nothing set, or nothing that matches, is no result at all.
  assert(context.snapBugResults({}, none).length === 0, "no traits, no results");
  assert(context.snapBugResults({ color: "", size: "", shape: "", tails: "" }, none).length === 0, "empty traits, no results");
  const nothing = context.snapBugResults({ color: "blue", shape: "fish", tails: "2" }, none);
  assert(nothing.length === 0, `traits no bug half-matches return nothing (${nothing.map((r) => r.bug.id)})`);

  // Tap mapping and sampling.
  const rect = { left: 100, top: 50, width: 200, height: 100 };
  const point = context.snapTapToPixel(150, 75, rect, 800, 400);
  assert(point.x === 200 && point.y === 100 && point.fx === .25 && point.fy === .25,
    `a tap maps by fraction of the displayed box, not by CSS pixels (${JSON.stringify(point)})`);
  const edge = context.snapTapToPixel(400, 400, rect, 800, 400);
  assert(edge.x === 799 && edge.y === 399, "a tap on the far edge stays inside the photo");
  assert(context.snapSampleRadius(rect, 800) === 12, "the sample patch is about three CSS pixels, in photo pixels");
  assert(context.snapSampleRadius({ width: 400 }, 100) === 1, "and never less than one pixel");
  const data = [];
  for (let i = 0; i < 9; i += 1) data.push(...(i === 4 ? [90, 0, 0, 255] : [0, 0, 0, 255]));
  assert(JSON.stringify(context.averageRgb(data, 3, 3, 1, 1, 1)) === JSON.stringify({ r: 10, g: 0, b: 0 }),
    "a patch is averaged, so one bright pixel does not decide the colour");
  assert(JSON.stringify(context.averageRgb(data, 3, 3, 0, 0, 0)) === JSON.stringify({ r: 0, g: 0, b: 0 }),
    "a zero radius reads one pixel");
  assert(context.rgbHex({ r: 100, g: 120, b: 40 }) === "#647828", "the swatch hex is exact");

  // Honesty, gating and the input.
  assert(html.includes('accept="image/*" capture="environment" data-snap-photo'), "the snap button opens the rear camera");
  assert(/does not recognise bugs from a photo/.test(html), "the panel says the photo is not recognised");
  assert(!/(AI|automatic(ally)?)[- ](identif|recogni)|identif(y|ies) (the|your) bug from/i.test(html),
    "nothing claims the app identifies a bug from its photo");
  const snapPanel = context.snapBugPanel.toString();
  assert(/if \(!proAccessActive\)/.test(snapPanel) && /proLock\(/.test(snapPanel), "Snap a bug is behind the Pro lock");
}

group("Your water: a profile learned only from the angler's own measured catches");
{
  const crooked = app.waters.find((water) => water.id === "crooked");
  const savedReports = { ...app.liveReports.byWater };
  Object.keys(app.liveReports.byWater).forEach((key) => delete app.liveReports.byWater[key]);
  const realHour = context.currentHour;
  const catchOn = (overrides) => ({
    loggedAt: "2026-06-21T01:00:00.000Z",
    date: "Jun 20, 2026",
    time: "6:00 PM",
    waterName: "Crooked River",
    waterId: "crooked",
    fly: "Zebra Midge #20",
    fish: "Redband Trout",
    length: "",
    count: "1",
    notes: "",
    flow: "240 cfs",
    flowSource: "measured",
    temp: "54 F",
    tempSource: "measured",
    ...overrides
  });

  // Empty journal: nothing is stated, nothing is added, nothing is taken away.
  localStorage.clear();
  app.setLogs([]);
  const empty = context.waterProfileFor(crooked);
  assert(empty.catches === 0 && !empty.enough && empty.flowBand === null && empty.timeBand === null,
    "an empty journal builds no profile");
  assert(context.personalScoreBonus(crooked).total === 0, "and adds nothing to the score");
  const emptyRow = context.scoreBreakdownItems(crooked).find(([label]) => label === "Your history");
  assert(emptyRow && emptyRow[1] === "No change" && /adds nothing/.test(emptyRow[2]),
    `the breakdown says so in a "Your history" row (${emptyRow && emptyRow.join(" | ")})`);

  // Two catches, both measured: below the minimum, so no band and no bonus.
  app.setLogs([catchOn({}), catchOn({ flow: "250 cfs" })]);
  const two = context.waterProfileFor(crooked);
  assert(two.catches === 2 && !two.enough && two.flowBand === null, "two catches are not a profile");
  app.liveReports.byWater.crooked = { status: "ready", usgs: { flow: "245 cfs", waterTemp: "54 F" }, nws: {} };
  context.currentHour = () => 18;
  assert(context.personalScoreBonus(crooked).total === 0, "two in-band catches still add nothing");

  // Five catches, but only two measured flows: the three reference values are
  // the app's own seed number, never an observation, and must not make a band.
  app.setLogs([
    catchOn({ flow: "230 cfs" }),
    catchOn({ flow: "250 cfs" }),
    catchOn({ flow: "4,160 cfs", flowSource: "reference" }),
    catchOn({ flow: "4,160 cfs", flowSource: "reference" }),
    catchOn({ flow: "4,160 cfs" , flowSource: "reference", tempSource: "reference" })
  ]);
  const referenceHeavy = context.waterProfileFor(crooked);
  assert(referenceHeavy.enough && referenceHeavy.catches === 5, "five catches are enough for a profile");
  assert(referenceHeavy.flowReadings === 2 && referenceHeavy.flowBand === null,
    `reference flows are not readings (${referenceHeavy.flowReadings} measured, band ${JSON.stringify(referenceHeavy.flowBand)})`);
  assert(referenceHeavy.tempReadings === 4 && referenceHeavy.tempBand.count === 4, "a reference temperature is left out of the temp band too");
  assert(context.personalScoreBonus(crooked).flow === 0, "no flow bonus without three measured readings");
  const needRow = context.scoreBreakdownItems(crooked).find(([label]) => label === "Your history");
  assert(/need 3\+ catches with a measured flow \(you have 2\)/.test(needRow[2]), `the breakdown says what is missing (${needRow[2]})`);

  // A third observation - "stale" is measured earlier, and counts.
  app.setLogs([
    catchOn({ flow: "230 cfs", time: "6:10 PM" }),
    catchOn({ flow: "250 cfs", time: "7:20 PM", fly: "X-Caddis #16" }),
    catchOn({ flow: "240 cfs", flowSource: "stale", time: "18:45", fly: "X-Caddis #16" }),
    catchOn({ flow: "4,160 cfs", flowSource: "reference", time: "", loggedAt: "2026-06-22T03:30:00.000Z", fly: "X-Caddis #16" }),
    catchOn({ flow: "No live gauge", flowSource: "unavailable", time: "11:00 AM", count: "2" })
  ]);
  const profile = context.waterProfileFor(crooked);
  assert(profile.flowReadings === 3, `measured and stale readings both count (${profile.flowReadings})`);
  assert(profile.flowBand && profile.flowBand.low === 230 && profile.flowBand.high === 250,
    `the flow band is built from measured readings only (${JSON.stringify(profile.flowBand)})`);
  assert(profile.timedCatches === 5, "a blank time falls back to the Pacific time it was saved");
  assert(profile.timeBand && profile.timeBand.start === 18 && profile.timeBand.end === 21,
    `12-hour, 24-hour and saved times all land in one Pacific band (${JSON.stringify(profile.timeBand)})`);
  assert(profile.topFlies[0].fly === "X-Caddis #16" && profile.topFlies[0].fish === 3, "top flies are ranked by fish");
  assert(profile.bestMonths[0].name === "Jun", "the best month is read on Oregon's clock");
  assert(context.catchHour({ time: "6:05 PM" }) === 18, "the narrow space iOS puts before PM still parses");
  const sixPm = context.bestTimeBand([18, 18, 18].map((hour) => ({ hour, fish: 1 })));
  assert(sixPm.start === 18 && sixPm.end === 20, `three 6 PM catches are a band that opens at 6 PM (${sixPm.start}-${sixPm.end})`);
  assert(context.bestTimeBand([6, 12, 20].map((hour) => ({ hour, fish: 1 }))) === null, "three catches spread across the day are no pattern");

  // Today inside the band, inside the best time: the bonus, and no more.
  context.currentHour = () => 19;
  const both = context.personalScoreBonus(crooked);
  assert(Math.abs(both.flow - .2) < 1e-9 && Math.abs(both.time - .1) < 1e-9, `flow and time each add their share (${both.flow}, ${both.time})`);
  assert(both.total <= .3 + 1e-9 && both.total > 0, `the bonus never exceeds +0.3 (${both.total})`);
  const bothRow = context.scoreBreakdownItems(crooked).find(([label]) => label === "Your history");
  assert(bothRow[1] === "+0.3" && /inside your 230-250 cfs band/.test(bothRow[2]) && /inside your best 6 PM-9 PM band/.test(bothRow[2]),
    `the breakdown names exactly what was added (${bothRow[1]}: ${bothRow[2]})`);
  const withHistory = Number(app.fishScore(crooked));
  const realBonus = context.personalScoreBonus;
  context.personalScoreBonus = () => ({ total: 0 });
  const withoutHistory = Number(app.fishScore(crooked));
  context.personalScoreBonus = realBonus;
  assert(withHistory - withoutHistory >= 0 && withHistory - withoutHistory <= .3 + 1e-9,
    `the score moves by the bonus and no more (${withoutHistory} -> ${withHistory})`);

  // Outside the band, outside the time: zero, never negative.
  app.liveReports.byWater.crooked = { status: "ready", usgs: { flow: "900 cfs", waterTemp: "54 F" }, nws: {} };
  context.currentHour = () => 9;
  const outside = context.personalScoreBonus(crooked);
  assert(outside.total === 0 && outside.flow === 0 && outside.time === 0, "outside the band and the window adds nothing and takes nothing");
  assert(/no bonus, no penalty/.test(context.scoreBreakdownItems(crooked).find(([label]) => label === "Your history")[2]),
    "and the breakdown says it is not a penalty");

  // An in-band flow that is not today's measurement is not compared.
  const stale = new Date(Date.now() - 30 * 3600000).toISOString();
  app.liveReports.byWater.crooked = { status: "ready", cachedAt: stale, usgs: { flow: "240 cfs", waterTemp: "54 F" }, nws: {} };
  assert(context.personalScoreBonus(crooked).flow === 0, "a day-old reading inside the band earns nothing");
  delete app.liveReports.byWater.crooked;
  assert(context.personalScoreBonus(crooked).flow === 0, "and neither does no reading at all");

  // Proven flies rise in the picks through the same fly-feedback ordering.
  app.setLogs([
    catchOn({ fly: "Purple Haze Custom" }),
    catchOn({ fly: "Purple Haze Custom", count: "2" }),
    catchOn({ fly: "Zebra Midge #20" }),
    catchOn({ fly: "<img src=x onerror=alert(1)>", count: "5" })
  ]);
  const picks = context.liveRecommendedFlies(crooked);
  assert(picks[0] === "Purple Haze Custom", `a fly with three fish here leads the picks (${picks.join(", ")})`);
  assert(!picks.some((fly) => fly.includes("<")), "a typed name carrying markup is never offered as a pick");
  context.setFlyFeedback("Purple Haze Custom", "ignored", { toggle: false });
  assert(context.liveRecommendedFlies(crooked)[0] !== "Purple Haze Custom", "an explicit Ignore still outranks history");
  context.setFlyFeedback("Purple Haze Custom", "ignored", { toggle: false });
  assert(context.liveRecommendedFlies(crooked)[0] !== "Purple Haze Custom", "setting ignored twice without toggling keeps it ignored");
  context.setFlyFeedback("Purple Haze Custom", "ignored");

  context.currentHour = realHour;
  app.setLogs([]);
  Object.assign(app.liveReports.byWater, savedReports);
}

group("ODFW regulations: every water has a sourced, dated entry");
{
  const regs = app.ODFW_REGULATIONS;
  const meta = app.ODFW_REGULATIONS_META;
  const ids = app.waters.map((water) => water.id);
  const missing = ids.filter((id) => !regs[id]);
  const extra = Object.keys(regs).filter((id) => !ids.includes(id));
  assert(!missing.length, `every app water has a regulations entry (${missing.join(", ") || "none missing"})`);
  assert(!extra.length, `no entry names a water the app does not have (${extra.join(", ") || "none"})`);
  assert(meta.year === 2026 && /^\d{4}-\d{2}-\d{2}$/.test(meta.checked), `the booklet year and checked date are recorded (${meta.year}, ${meta.checked})`);
  const allowedHost = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && /(^|\.)(myodfw\.com|eregulations\.com)$/.test(parsed.hostname);
    } catch {
      return false;
    }
  };
  const badSource = Object.entries(regs).filter(([, entry]) => !allowedHost(entry.source)).map(([id]) => id);
  assert(!badSource.length, `every source URL is on myodfw.com or eregulations.com (${badSource.join(", ") || "all"})`);
  const badLinks = Object.entries(meta.links).filter(([, url]) => !allowedHost(url)).map(([key]) => key);
  assert(!badLinks.length, `every ODFW link in the meta is on myodfw.com or eregulations.com (${badLinks.join(", ") || "all"})`);
  assert(/regulation-updates/.test(meta.links.updates), "the in-season changes page is linked");
  const malformed = Object.entries(regs).filter(([, entry]) => !(
    entry.year === meta.year
    && /^\d{4}-\d{2}-\d{2}$/.test(entry.checked)
    && typeof entry.zone === "string" && entry.zone
    && Array.isArray(entry.summary) && entry.summary.length && entry.summary.every((line) => typeof line === "string" && line.trim())
    && typeof entry.gear === "string" && entry.gear
    && typeof entry.harvest === "string" && entry.harvest
    && typeof entry.notes === "string"
    && ["confirmed", "verify"].includes(entry.confidence)
  )).map(([id]) => id);
  assert(!malformed.length, `every entry has year, checked, zone, summary, gear, harvest, notes, source and confidence (${malformed.join(", ") || "all"})`);
  const verifyWithoutReason = Object.entries(regs).filter(([, entry]) => entry.confidence === "verify" && !(typeof entry.uncertain === "string" && entry.uncertain.length > 20)).map(([id]) => id);
  assert(!verifyWithoutReason.length, `every verify entry says what is uncertain (${verifyWithoutReason.join(", ") || "all"})`);
  const confirmedWithoutSeason = Object.entries(regs).filter(([, entry]) => entry.confidence === "confirmed" && !entry.season).map(([id]) => id);
  assert(!confirmedWithoutSeason.length, `every confirmed entry records its season (${confirmedWithoutSeason.join(", ") || "all"})`);
  const markup = Object.entries(regs).filter(([, entry]) => /[<>]/.test([...entry.summary, entry.gear, entry.harvest, entry.notes, entry.uncertain || ""].join(" "))).map(([id]) => id);
  assert(!markup.length, `no regulation text carries markup (${markup.join(", ") || "none"})`);
  assert(!/Stocked lake regulations apply|Always confirm current ODFW regulations/.test(html), "the old generic regulations line is gone");
  assert(app.waters.every((water) => !("regs" in water)), "no water still carries the old regs string");
  const counts = Object.values(regs).reduce((memo, entry) => ({ ...memo, [entry.confidence]: (memo[entry.confidence] || 0) + 1 }), {});
  console.log(`       ${counts.confirmed || 0} confirmed, ${counts.verify || 0} verify`);
}

group("ODFW regulations: season windows, wrap-around and sections");
{
  const open = context.seasonWindowOpen;
  assert(open({ allYear: true }, "02-29") === true, "an all-year season is open on any day");
  assert(open({ from: "05-22", to: "10-31" }, "05-21") === false, "a window is closed the day before it opens");
  assert(open({ from: "05-22", to: "10-31" }, "05-22") === true, "open on its first day (inclusive)");
  assert(open({ from: "05-22", to: "10-31" }, "10-31") === true, "open on its last day (inclusive)");
  assert(open({ from: "05-22", to: "10-31" }, "11-01") === false, "closed the day after");
  const winter = { from: "11-01", to: "02-28" };
  assert(open(winter, "12-31") === true && open(winter, "01-01") === true, "a season that wraps the new year is open across it");
  assert(open(winter, "11-01") === true && open(winter, "02-28") === true, "and on both of its ends");
  assert(open(winter, "10-31") === false && open(winter, "03-01") === false, "and closed outside it");
  assert(open({ from: "5-22", to: "10-31" }, "06-01") === null, "a malformed window is unknown, never open");
  assert(open({}, "06-01") === null, "an empty season is unknown");

  const realRegs = { ...app.ODFW_REGULATIONS };
  const probe = { id: "regs-probe", name: "Probe" };
  const set = (entry) => { app.ODFW_REGULATIONS["regs-probe"] = { year: 2026, checked: "2026-11-18", zone: "Central", summary: ["x"], gear: "x", harvest: "x", notes: "", source: "https://myodfw.com/", confidence: "confirmed", ...entry }; };
  set({ season: { sections: [{ name: "Lower", allYear: true }, { name: "Upper", from: "05-22", to: "09-30" }] } });
  const partial = context.regulationSeasonDetail(probe, "2026-11-18");
  assert(partial.status === "partial" && partial.open.join() === "Lower" && partial.closed.join() === "Upper", `some sections open is partial, naming each (${JSON.stringify(partial)})`);
  assert(context.regulationSeasonStatus(probe, "2026-07-04") === "open", "every section open is open");
  set({ season: { sections: [{ name: "A", from: "05-22", to: "09-30" }, { name: "B", from: "04-22", to: "10-31" }] } });
  assert(context.regulationSeasonStatus(probe, "2026-12-01") === "closed", "no section open is closed");
  set({ season: { sections: [{ name: "A", allYear: true }, { name: "B", from: "bad", to: "10-31" }] } });
  assert(context.regulationSeasonStatus(probe, "2026-12-01") === "unknown", "one malformed section makes the water unknown");
  set({ season: { allYear: true }, confidence: "verify", uncertain: "zone not confirmed for this probe water" });
  assert(context.regulationSeasonStatus(probe, "2026-12-01") === "unknown", "a verify entry is unknown even with a season recorded");
  set({ season: null });
  assert(context.regulationSeasonStatus(probe, "2026-12-01") === "unknown", "a missing season is unknown");
  delete app.ODFW_REGULATIONS["regs-probe"];
  assert(context.regulationSeasonStatus(probe, "2026-12-01") === "unknown", "a water with no entry is unknown");
  assert(Object.keys(app.ODFW_REGULATIONS).length === Object.keys(realRegs).length, "the probe left the table as it was");
}

group("ODFW regulations: status on boundary dates, on Oregon's clock");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  // Apr 22 00:00 PDT is 07:00 UTC; Oct 31 23:59 PDT is Nov 1 06:59 UTC.
  assert(context.regulationSeasonStatus(water("crane-prairie"), new Date("2026-04-22T06:59:00Z")) === "closed", "Crane Prairie is closed at 11:59 PM Apr 21 in Oregon, though it is Apr 22 in UTC");
  assert(context.regulationSeasonStatus(water("crane-prairie"), new Date("2026-04-22T07:00:00Z")) === "open", "and open at midnight Apr 22 Pacific");
  assert(context.regulationSeasonStatus(water("whychus"), new Date("2026-11-01T06:59:00Z")) === "open", "a zone stream is open at 11:59 PM Oct 31 Pacific, though it is Nov 1 in UTC");
  assert(context.regulationSeasonStatus(water("whychus"), new Date("2026-11-01T07:00:00Z")) === "closed", "and closed at midnight Nov 1 Pacific");
  assert(context.regulationSeasonStatus(water("whychus"), new Date("2026-05-22T07:00:00Z")) === "open", "and opens at midnight May 22 Pacific");
  assert(context.regulationSeasonStatus(water("fall-river"), "2026-10-01") === "partial", "Fall River below the falls closes after Sep 30; above stays open");
  assert(context.regulationSeasonStatus(water("lower-deschutes"), "2026-01-15") === "partial", "the Lower Deschutes above the Reservation boundary is closed in January");
  assert(context.regulationSeasonStatus(water("lower-deschutes"), "2026-04-22") === "open", "and open again from Apr 22");

  const nov18 = new Date("2026-11-18T20:00:00Z");
  const byStatus = {};
  app.waters.forEach((item) => {
    const status = context.regulationSeasonStatus(item, nov18);
    (byStatus[status] = byStatus[status] || []).push(item.id);
  });
  const closedExpected = ["whychus", "tumalo", "little-deschutes", "crane-prairie", "wickiup", "odell-lake", "crescent-creek", "spring-river", "paulina-creek"];
  assert(JSON.stringify([...(byStatus.closed || [])].sort()) === JSON.stringify([...closedExpected].sort()),
    `closed on Nov 18, 2026: ${(byStatus.closed || []).join(", ")}`);
  assert(JSON.stringify([...(byStatus.partial || [])].sort()) === JSON.stringify(["fall-river", "lake-billy-chinook", "metolius", "ochoco-creek", "upper-deschutes"]),
    `partly open on Nov 18, 2026: ${(byStatus.partial || []).join(", ")}`);
  const verifyIds = Object.entries(app.ODFW_REGULATIONS).filter(([, entry]) => entry.confidence === "verify").map(([id]) => id).sort();
  assert(JSON.stringify([...(byStatus.unknown || [])].sort()) === JSON.stringify(verifyIds), `unknown is exactly the verify waters (${(byStatus.unknown || []).length})`);
}

group("ODFW regulations: a closed water is never the top pick or ranked as fishable");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const realKey = context.pacificDateKey;
  context.pacificDateKey = () => "2026-11-18";
  const crane = water("crane-prairie");
  const realScore = crane.score;
  crane.score = 100;
  const ranked = context.rankedWatersForCurrentMode(app.waters);
  const statuses = ranked.map((item) => context.regulationSeasonStatus(item));
  const firstClosed = statuses.indexOf("closed");
  assert(firstClosed > 0 && statuses.slice(firstClosed).every((status) => status === "closed"), `every closed water ranks after every other water (first closed at #${firstClosed + 1} of ${ranked.length})`);
  assert(context.topRecommendedWater().id !== "crane-prairie", `a closed water with the best conditions is not the top pick (${context.topRecommendedWater().id})`);
  assert(context.regulationSeasonStatus(context.topRecommendedWater()) !== "closed", "the top pick is never in a closed season");
  assert(ranked.indexOf(crane) === firstClosed, "among closed waters the score still orders them");
  assert(context.fishabilitySummary(crane) === "Closed season (ODFW)", `a closed water is labelled, not called fishable (${context.fishabilitySummary(crane)})`);
  const unknownRank = ranked.findIndex((item) => context.regulationSeasonStatus(item) === "unknown");
  assert(unknownRank >= 0 && unknownRank < firstClosed, "an unconfirmed water is not treated as closed");
  const headline = context.watersHeadlineMarkup({ topWater: crane });
  assert(/Closed season \(ODFW\)/.test(headline), "a closed water heading a filtered list is labelled");
  const rows = context.scoreBreakdownItems(crane);
  assert(rows[0][0] === "ODFW season" && rows[0][1] === "Closed today" && /2026 ODFW regulations - checked Nov 18, 2026/.test(rows[0][2]), `the rating breakdown says the water is closed (${rows[0].join(" | ")})`);
  const partialRow = context.scoreBreakdownItems(water("metolius"))[0];
  assert(partialRow[0] === "ODFW season" && /Allingham/.test(partialRow[2]), `a partly open water names the closed section (${partialRow[2]})`);
  assert(context.scoreBreakdownItems(water("crooked"))[0][0] !== "ODFW season", "an open water gets no season row");
  crane.score = realScore;
  context.pacificDateKey = realKey;
}

group("ODFW regulations: the planner does not score a closed-season day");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const whychus = water("whychus");
  const hourly = "https://api.weather.gov/gridpoints/PDT/31,77/forecast/hourly";
  const coords = app.waterCoordinates.whychus;
  app.setNwsGrid(`${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`, hourly);
  const days = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].map((date) => ({ date, highF: 55, windMph: 6, forecast: "Cloudy" }));
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/31,77/forecast": { fetchedAt: new Date().toISOString(), days } });
  const plan = context.plannerForWater(whychus, "2026-10-30");
  assert(plan.days.length === 4, `the forecast is planned (${plan.days.length} days)`);
  assert(plan.days[0].score !== null && plan.days[1].score !== null, "days inside the season are scored");
  assert(plan.days[2].score === null && plan.days[3].score === null, "days after the season closes get no score");
  assert(plan.days[2].reason === "Closed season (ODFW)", `and say Closed season (${plan.days[2].reason})`);
  assert(plan.best && plan.best.date <= "2026-10-31", `the best day is never a closed-season day (${plan.best?.date})`);
  const closedWeek = context.plannerForWater(whychus, "2026-11-01");
  assert(closedWeek.best === null && closedWeek.days.every((day) => day.regulationClosed), "an all-closed week has no best day");
  assert(/planner-day\s+\S*\s*closed/.test(context.plannerDayRow(closedWeek.days[0], null)), "a closed-season day row carries the closed class");
  app.setPlannerForecasts({});
}

group("ODFW regulations: the block says it is a summary and links out");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const block = context.regulationsBlock(water("metolius"));
  assert(/2026 ODFW regulations - checked Nov 18, 2026/.test(block), "the block names the booklet year and the date checked");
  assert(/Summary only\. Regulations change and in-season rules apply - check ODFW before you fish\./.test(block), "and says it is a summary, not the law");
  const links = [...block.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)];
  assert(links.length >= 2 && links.every(([tag, href]) => /target="_blank"/.test(tag) && /rel="noopener"/.test(tag) && /^https:\/\/(www\.)?(myodfw|eregulations)\.com\//.test(href)),
    `every link goes to ODFW or eRegulations and opens outside the app (${links.length})`);
  assert(block.includes(app.ODFW_REGULATIONS_META.links.updates), "the in-season changes page is linked");
  assert(!/Verify with ODFW/.test(block), "a confirmed water has no verify note");
  const verify = context.regulationsBlock(water("bridge-creek"));
  assert(/Verify with ODFW:/.test(verify) && /Season not confirmed - check ODFW/.test(verify), "a verify water says to verify, and that its season is not confirmed");
  const compact = context.regulationsBlock(water("whychus"), { compact: true });
  assert(/data-regs-block="whychus"/.test(compact) && /Artificial flies and lures only/.test(compact), "the compact block shows the gear rule");
  assert(app.clickActions.some(([selector]) => selector === "[data-regs-block]"), "a tap in the block is caught before it collapses the card");
}

group("ODFW regulations: the March 1 check for a new booklet");
{
  const due = context.regulationsCheckDue;
  assert(due({}, "2027-02-28") === false, "not due on Feb 28");
  assert(due({}, "2027-03-01") === true, "due on Mar 1");
  assert(due({ year: 2027, ok: true }, "2027-08-01") === false, "not due again once this year's check succeeded");
  assert(due({ year: 2026, ok: true, attemptedOn: "2026-03-01" }, "2027-03-01") === true, "due again when the year rolls over");
  assert(due({ year: 2027, ok: false, attemptedOn: "2027-03-01" }, "2027-03-01") === false, "a failed check is not retried the same day");
  assert(due({ year: 2027, ok: false, attemptedOn: "2027-03-01" }, "2027-03-02") === true, "and is retried the next day");
  assert(due({}, context.pacificDateKey(new Date("2027-03-01T07:59:00Z"))) === false, "11:59 PM Feb 28 in Oregon is not Mar 1, though it is in UTC");
  assert(due({}, context.pacificDateKey(new Date("2027-03-01T08:00:00Z"))) === true, "midnight Mar 1 Pacific is");
  assert(due({}, "garbage") === false, "a malformed date is never due");

  const extract = context.extractPublishedRegulationsYear;
  assert(extract("<p>Changes to the permanent regulations in the 2026 Oregon Sport Fishing Regulations.</p><p>See the 2027 Oregon Sport Fishing Regulations</p>", 2027) === 2027, "several booklets named: the newest wins");
  assert(extract("<footer>&copy; Copyright 2028 ODFW</footer><p>2026 Oregon Sport Fishing Regulations</p>", 2027) === 2026, "a copyright year is not a booklet");
  assert(extract("<p>Effective August 1, 2027 through December 31, 2027</p>", 2027) === null, "a page naming no booklet gives no year");
  assert(extract("<h2><b>2027</b> Oregon Sport <i>Fishing</i>\n Regulations</h2>", 2027) === 2027, "markup inside the phrase is read as text");
  assert(extract("<script>var x = '2031 Oregon Sport Fishing Regulations'</script><p>none</p>", 2027) === null, "script text is not read");
  assert(extract("2099 Oregon Sport Fishing Regulations", 2027) === null, "a year far in the future is ignored");
  assert(extract(null) === null && extract(undefined) === null && extract(12345) === null && extract("<<<>>>&&&") === null, "garbage gives no year and does not throw");

  const realFetch = context.fetchTextWithTimeout;
  const realOnline = context.navigator.onLine;
  const read = () => context.readRegulationsCheck();
  context.localStorage.removeItem(app.REGS_CHECK_KEY);
  let fetched = [];
  context.fetchTextWithTimeout = async (url) => { fetched.push(url); return "<p>See the 2027 Oregon Sport Fishing Regulations.</p>"; };
  const ok = await context.runRegulationsAnnualCheck({ dateKey: "2027-03-01", render: false });
  assert(ok === true && fetched.length === 1 && /^https:\/\/(www\.)?myodfw\.com\//.test(fetched[0]), `one request, to myodfw.com (${fetched.join(", ")})`);
  assert(read().ok && read().year === 2027 && read().publishedYear === 2027 && read().attemptedOn === "2027-03-01", `a successful check is stored (${JSON.stringify(read())})`);
  assert(!due(read(), "2027-03-02"), "and is not repeated this year");

  context.localStorage.removeItem(app.REGS_CHECK_KEY);
  fetched = [];
  context.fetchTextWithTimeout = async () => { throw new Error("ODFW regulations check 503"); };
  const failed = await context.runRegulationsAnnualCheck({ dateKey: "2027-03-01", render: false });
  assert(failed === false && read().ok === false && read().attemptedOn === "2027-03-01", "a failed check is recorded as not done");
  assert(!due(read(), "2027-03-01") && due(read(), "2027-03-02"), "and retried on the next day, not the same one");
  context.fetchTextWithTimeout = async () => "<p>No booklet named here</p>";
  await context.runRegulationsAnnualCheck({ dateKey: "2027-03-02", render: false });
  assert(read().ok === false, "a page that names no booklet is not a successful check");

  context.localStorage.removeItem(app.REGS_CHECK_KEY);
  context.navigator.onLine = false;
  fetched = [];
  context.fetchTextWithTimeout = async (url) => { fetched.push(url); return ""; };
  const offline = await context.runRegulationsAnnualCheck({ dateKey: "2027-03-01", render: false });
  assert(offline === false && !fetched.length && read().attemptedOn === null, "offline is not an attempt: nothing fetched, the online event retries");
  context.navigator.onLine = realOnline;
  context.fetchTextWithTimeout = realFetch;

  const water = (id) => app.waters.find((item) => item.id === id);
  const stale = context.regulationsStaleness;
  assert(stale("2026-11-18", {}) === null, "no warning in the booklet's own year");
  assert(stale("2026-12-31", {}) === null, "nor on Dec 31 of that year");
  // D9: the new booklet takes effect Jan 1, so the calendar warning starts
  // then, while the network check still waits for March 1.
  const jan1 = stale("2027-01-01", {});
  assert(jan1?.kind === "calendar" && jan1.message === "ODFW's 2027 regulations took effect Jan 1. This summary is from 2026 - check ODFW before you fish.",
    `from Jan 1 of the next year the calendar alone warns (${jan1?.message})`);
  assert(stale("2027-02-28", {})?.kind === "calendar", "including before the Mar 1 check");
  assert(context.regulationStatusLabel("closed", jan1) === "Closed season (2026 rules)", "and season labels say they are the 2026 rules from Jan 1");
  assert(due({}, "2027-01-01") === false, "while the network check still waits for Mar 1");
  assert(stale("2027-03-01", {})?.kind === "calendar", "from Mar 1 the calendar warns even if no check ever got through");
  assert(stale("2028-01-15", {})?.kind === "calendar", "and keeps warning in later years");
  const newer = stale("2026-12-20", { publishedYear: 2027 });
  assert(newer?.kind === "newer" && newer.message === "ODFW has published 2027 regulations. This summary is from 2026 and may be out of date - check ODFW before you fish.",
    `a newer booklet seen by the check warns at once (${newer?.message})`);
  assert(stale("2026-12-20", { publishedYear: 2026 }) === null, "the same booklet year is not news");
  assert(context.regulationStatusLabel("closed", newer) === "Closed season (2026 rules)" && context.regulationStatusLabel("closed", null) === "Closed season (ODFW)",
    "while stale, season labels say whose rules they are");
  assert(context.regulationStatusLabel("unknown", newer) === "Season not confirmed - check ODFW", "an unknown season label is unchanged");

  context.localStorage.setItem(app.REGS_CHECK_KEY, JSON.stringify({ year: 2026, ok: true, checkedAt: "2026-12-20T18:00:00Z", attemptedOn: "2026-12-20", publishedYear: 2027 }));
  const realKey = context.pacificDateKey;
  context.pacificDateKey = (date) => (date ? realKey(date) : "2026-12-20");
  const block = context.regulationsBlock(water("crooked"));
  assert(block.includes("ODFW has published 2027 regulations. This summary is from 2026 and may be out of date - check ODFW before you fish."), "every Regulations block carries the warning");
  assert(/Verify with ODFW:/.test(block), "and treats the entry as one to verify");
  assert(/Open season \(2026 rules\)/.test(block), "the status says it is the 2026 rules");
  assert(/Checked for new ODFW regulations Dec 20, 2026/.test(block), "the block says when the check last ran");
  assert(context.regulationSeasonStatus(water("whychus")) === "closed", "season gating still runs on the bundled rules");
  assert(context.fishabilitySummary(water("whychus")) === "Closed season (2026 rules)", "and its closed label names the year");
  context.localStorage.setItem(app.REGS_CHECK_KEY, JSON.stringify({ year: 2026, ok: false, attemptedOn: "2026-12-19" }));
  assert(/Couldn(&#39;|&#039;|')t check for new ODFW regulations yet - will retry/.test(context.regulationsBlock(water("crooked"))), "a failed check says it will retry");
  assert(!/ODFW has published/.test(context.regulationsBlock(water("crooked"))), "and claims no new booklet");
  context.localStorage.removeItem(app.REGS_CHECK_KEY);
  context.pacificDateKey = (date) => (date ? realKey(date) : "2027-02-10");
  assert(/Next check for new ODFW regulations: Mar 1, 2027/.test(context.regulationsCheckLine()), "before Mar 1 the block says when the next check is");
  context.pacificDateKey = realKey;
  assert(/riseRegsCheck\.v1/.test(app.REGS_CHECK_KEY) && /^https:\/\/myodfw\.com\//.test(app.REGS_CHECK_URL), "the check has its own storage key and an allowed ODFW URL");
}

group("On the water: the prime-window countdown");
{
  const crooked = app.waters.find((water) => water.id === "crooked");
  const realWindow = context.primeWindowHours;
  context.primeWindowHours = () => [18, 21];
  // June: Pacific Daylight Time, UTC-7.
  const before = context.primeWindowCountdown(crooked, new Date("2026-06-21T23:20:00Z"));
  const during = context.primeWindowCountdown(crooked, new Date("2026-06-22T02:40:00Z"));
  const after = context.primeWindowCountdown(crooked, new Date("2026-06-22T04:30:00Z"));
  assert(before.state === "before" && before.text === "Prime window starts in 1h 40m", `before the window (${before.text})`);
  assert(during.state === "during" && during.text === "Prime window ends in 1h 20m", `inside the window (${during.text})`);
  assert(after.state === "after" && /passed/.test(after.text), `after the window (${after.text})`);
  assert(during.end.toISOString() === "2026-06-22T04:00:00.000Z", `the window ends at a real instant for the Live Activity (${during.end.toISOString()})`);
  const nearEnd = context.primeWindowCountdown(crooked, new Date("2026-06-22T03:59:30Z"));
  assert(nearEnd.text === "Prime window ends in 1m", `the last seconds read as a minute, never zero (${nearEnd.text})`);
  context.primeWindowHours = () => null;
  assert(context.primeWindowCountdown(crooked).state === "unknown", "a wind-decided window says so instead of counting down");
  context.primeWindowHours = realWindow;
}

group("Apple Watch: the trip pack carries readings with their provenance");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const savedReports = { ...app.liveReports.byWater };
  const savedBefore = [...app.savedWatersNow()];
  savedBefore.forEach((id) => context.toggleSavedWater(id));
  app.setHomeWaterId("crooked");
  const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
  app.liveReports.byWater.crooked = {
    status: "ready",
    cachedAt: hoursAgo(2),
    usgs: { flow: "240 cfs", waterTemp: "53 F", observedAt: hoursAgo(2.5) },
    nws: { wind: "6 mph", forecast: "Cloudy" }
  };
  delete app.liveReports.byWater.hosmer;
  delete app.liveReports.byWater.whychus;
  context.toggleSavedWater("hosmer");
  context.toggleSavedWater("whychus");

  const pack = context.buildWatchPack(new Date());
  const byId = Object.fromEntries(pack.waters.map((item) => [item.id, item]));
  const crookedPack = byId.crooked;
  assert(pack.version === 1 && !Number.isNaN(Date.parse(pack.generatedAt)), "the pack is versioned and says when it was built");
  assert(pack.pacificDate === context.pacificDateKey(new Date()), `the pack names its Pacific date (${pack.pacificDate})`);
  assert(pack.waters[0]?.id === "crooked" && crookedPack.home === true, `home water comes first (${pack.waters.map((item) => item.id).join(", ")})`);
  const savedOrder = pack.waters.slice(1, 3).map((item) => item.id).sort().join(",");
  assert(savedOrder === "hosmer,whychus" && byId.hosmer.saved && byId.whychus.saved, `saved waters follow home (${pack.waters.map((item) => item.id).join(", ")})`);
  assert(pack.waters.some((item) => item.topPick), "today's top pick is in the pack");
  assert(JSON.stringify(pack.species) === JSON.stringify(app.nativeFish), "the Watch's species list is the app's list");
  assert(crookedPack.usgsSite === "14080500" && byId.hosmer.usgsSite === null, "a gauged water carries its USGS site, a lake carries none");
  assert(crookedPack.lat === app.waterCoordinates.crooked.lat && crookedPack.lon === app.waterCoordinates.crooked.lon, "coordinates come from waterCoordinates");
  assert(crookedPack.score === Number(context.fishScore(water("crooked"))) && crookedPack.scoreSource === context.scoreSourceLabel(water("crooked")),
    `the score and its honest source label are the app's own (${crookedPack.score}, ${crookedPack.scoreSource})`);
  const hours = context.primeWindowHours(water("crooked"));
  assert(JSON.stringify(crookedPack.primeWindow) === JSON.stringify(hours ? { startHour: hours[0], endHour: hours[1] } : null),
    `the prime window is today's Pacific hours (${JSON.stringify(crookedPack.primeWindow)})`);
  assert(crookedPack.flow.value === "240 cfs" && crookedPack.flow.source === "measured", `a fresh gauge reading is measured (${JSON.stringify(crookedPack.flow)})`);
  assert(crookedPack.flow.observedAt === app.liveReports.byWater.crooked.usgs.observedAt && crookedPack.flow.cachedAt === app.liveReports.byWater.crooked.cachedAt,
    "and carries when USGS took it and when it was cached");
  assert(crookedPack.temp.value === "53 F" && crookedPack.temp.source === "measured", "the water temperature travels the same way");
  assert(crookedPack.flow.reference === water("crooked").flow, "the seasonal value travels as the fallback, labelled as such");
  assert(byId.hosmer.flow.source === "reference" && byId.hosmer.flow.observedAt === null && byId.hosmer.flow.cachedAt === null,
    `a lake's flow is reference and carries no measurement time (${JSON.stringify(byId.hosmer.flow)})`);
  assert(byId.whychus.flow.source === "unavailable" && byId.whychus.flow.value === "No live gauge" && byId.whychus.flow.reference === "",
    `an ungauged river says so and has nothing to fall back to (${JSON.stringify(byId.whychus.flow)})`);
  assert(crookedPack.flies.length > 0 && crookedPack.flies.length <= 6 && new Set(crookedPack.flies).size === crookedPack.flies.length,
    `up to six distinct flies (${crookedPack.flies.join(", ")})`);
  assert(crookedPack.flies[0] === context.liveRecommendedFlies(water("crooked"))[0], "in the order the app recommends them");
  assert(Array.isArray(crookedPack.hatches) && crookedPack.hatches.length <= 4, "predicted hatches are carried");
  assert(crookedPack.planner === null, "no planner days are invented when the week was never loaded");

  app.liveReports.byWater.crooked = { ...app.liveReports.byWater.crooked, cachedAt: hoursAgo(20) };
  const stalePack = context.buildWatchPack(new Date());
  assert(stalePack.waters[0].flow.source === "stale", `a reading past the 12-hour fresh window travels as stale (${stalePack.waters[0].flow.source})`);
  app.liveReports.byWater.crooked = { ...app.liveReports.byWater.crooked, cachedAt: hoursAgo(24 * 8) };
  const expiredPack = context.buildWatchPack(new Date());
  assert(expiredPack.waters[0].flow.source === "reference" && expiredPack.waters[0].flow.value === water("crooked").flow && expiredPack.waters[0].flow.observedAt === null,
    `an expired reading is not sent as a measurement (${JSON.stringify(expiredPack.waters[0].flow)})`);

  const coords = app.waterCoordinates.crooked;
  app.setNwsGrid(`${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`, "https://api.weather.gov/gridpoints/PDT/77,77/forecast/hourly");
  const days = [0, 1, 2].map((offset) => ({ date: context.pacificDateKey(new Date(Date.now() + offset * 86400000)), highF: 50, windMph: offset === 1 ? 4 : 22, forecast: offset === 1 ? "Cloudy" : "Sunny" }));
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/77,77/forecast": { fetchedAt: new Date().toISOString(), days } });
  const planned = context.buildWatchPack(new Date()).waters[0].planner;
  assert(planned && planned.days.length === 3 && planned.days.every((day) => typeof day.score === "number" && day.label && day.reason),
    `a loaded week travels with its day scores (${JSON.stringify(planned?.days?.map((day) => day.score))})`);
  assert(planned?.best?.date === days[1].date, `and its best day (${planned?.best?.date})`);
  app.setPlannerForecasts({});

  ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].forEach((_, index) => {
    const id = app.waters[index + 10]?.id;
    if (id && !app.savedWatersNow().includes(id)) context.toggleSavedWater(id);
  });
  const capped = context.buildWatchPack(new Date());
  assert(capped.waters.length === 10 && capped.waters[0].id === "crooked", `the pack is capped at ten waters, home still first (${capped.waters.length})`);
  assert(JSON.parse(JSON.stringify(capped)).waters.length === 10, "and survives JSON");

  [...app.savedWatersNow()].forEach((id) => context.toggleSavedWater(id));
  savedBefore.forEach((id) => context.toggleSavedWater(id));
  for (const key of Object.keys(app.liveReports.byWater)) delete app.liveReports.byWater[key];
  Object.assign(app.liveReports.byWater, savedReports);
}

group("Apple Watch: a pack is posted only when it changed");
{
  const posted = [];
  app.resetWatchPack();
  assert(context.postWatchPack() === false, "without the riseWatch handler nothing is posted");
  context.webkit = { messageHandlers: { riseWatch: { postMessage: (message) => posted.push(JSON.parse(JSON.stringify(message))) } } };
  app.resetWatchPack();
  const savedReports = { ...app.liveReports.byWater };
  // The harness's launch sync never settles (fetch is disabled); these
  // checks are about a settled page.
  const savedBulk = app.liveReports.bulkStatus;
  app.liveReports.bulkStatus = "";
  for (const [key, report] of Object.entries(app.liveReports.byWater)) {
    if (report?.status === "loading" || report?.refreshing) delete app.liveReports.byWater[key];
  }
  app.liveReports.byWater.crooked = { status: "ready", cachedAt: new Date().toISOString(), usgs: { flow: "240 cfs", waterTemp: "53 F" }, nws: {} };
  assert(context.postWatchPack() === true && posted.length === 1, "the first pack is posted");
  assert(posted[0].action === "pack" && typeof posted[0].body === "string" && JSON.parse(posted[0].body).waters.length > 0,
    "as { action: \"pack\", body } with the pack as JSON");
  assert(context.postWatchPack() === false && posted.length === 1, "an unchanged pack is not posted again, though its generatedAt moved");
  app.liveReports.byWater.crooked = { ...app.liveReports.byWater.crooked, usgs: { flow: "310 cfs", waterTemp: "53 F" } };
  const homeIsCrooked = JSON.parse(posted[0].body).waters.some((item) => item.id === "crooked");
  if (!homeIsCrooked) app.setHomeWaterId("crooked");
  assert(context.postWatchPack() === true && posted.length === 2, "a new reading posts a new pack");
  context.toggleSavedWater("metolius");
  assert(context.postWatchPack() === true && posted.length === 3, "saving a water posts a new pack");
  context.toggleSavedWater("metolius");
  context.postWatchPack();
  const before = posted.length;
  for (let index = 0; index < 5; index += 1) context.renderScreens("today");
  context.toggleSavedWater("hosmer");
  for (let index = 0; index < 5; index += 1) context.scheduleWatchPack();
  await new Promise((done) => setTimeout(done, app.WATCH_PACK_DEBOUNCE_MS + 200));
  assert(posted.length === before + 1, `a burst of renders posts one pack, after the debounce (${posted.length - before})`);
  context.toggleSavedWater("hosmer");
  context.webkit = { messageHandlers: { riseWatch: { postMessage() { throw new Error("bridge gone"); } } } };
  const keyBefore = app.watchPackPostedKeyNow();
  assert(context.postWatchPack() === false && app.watchPackPostedKeyNow() === keyBefore, "a throwing bridge is not recorded as posted, so the next change retries");

  // Mid-sync the labels are transient ("Checking live inputs"): no pack.
  context.webkit = { messageHandlers: { riseWatch: { postMessage: (message) => posted.push(JSON.parse(JSON.stringify(message))) } } };
  app.resetWatchPack();
  app.setHomeWaterId("crooked");
  app.liveReports.bulkStatus = "manual";
  const beforeSync = posted.length;
  assert(context.postWatchPack() === false && posted.length === beforeSync && app.watchPackPostedKeyNow() === null, "no pack is posted while a sync is running");
  app.liveReports.bulkStatus = "";
  const settledCrooked = app.liveReports.byWater.crooked;
  app.liveReports.byWater.crooked = { status: "loading", meta: {} };
  assert(context.postWatchPack() === false && posted.length === beforeSync, "nor while a pack water's report is loading");
  app.liveReports.byWater.crooked = { ...settledCrooked, refreshing: true };
  assert(context.postWatchPack() === false && posted.length === beforeSync, "nor while one is refreshing");
  app.liveReports.byWater.crooked = settledCrooked;
  assert(context.postWatchPack() === true && posted.length === beforeSync + 1, "the settled pack is posted once the sync is done");
  const settledPack = JSON.parse(posted[posted.length - 1].body);
  assert(!settledPack.waters.some((item) => /Updating local cache|Checking live inputs/.test(item.scoreSource)),
    `and carries no transient label (${settledPack.waters.map((item) => item.scoreSource).join(" | ")})`);

  app.resetWatchPack();
  context.webkit = undefined;
  app.liveReports.bulkStatus = savedBulk;
  for (const key of Object.keys(app.liveReports.byWater)) delete app.liveReports.byWater[key];
  Object.assign(app.liveReports.byWater, savedReports);
}

group("Apple Watch: the trip pack carries the ODFW season and snow access, re-evaluable by date");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const savedBefore = [...app.savedWatersNow()];
  savedBefore.forEach((id) => context.toggleSavedWater(id));
  app.setHomeWaterId("crooked");
  ["crane-prairie", "lower-deschutes", "hosmer"].forEach((id) => context.toggleSavedWater(id));
  const verifyId = Object.keys(app.ODFW_REGULATIONS).find((id) => app.ODFW_REGULATIONS[id].confidence !== "confirmed" && water(id));
  if (verifyId) context.toggleSavedWater(verifyId);
  const packOn = (iso) => {
    const pack = context.buildWatchPack(new Date(iso));
    return Object.fromEntries(pack.waters.map((item) => [item.id, item]));
  };

  // Nov 2 (Pacific): Crane Prairie's Apr 22 - Oct 31 season is over.
  const nov = packOn("2026-11-02T19:00:00.000Z");
  const crane = nov["crane-prairie"];
  assert(crane && crane.regulation.status === "closed" && crane.regulation.label === context.regulationStatusLabel("closed"),
    `a closed water says so in the pack (${JSON.stringify(crane?.regulation)})`);
  assert(crane.regulation.status === context.regulationSeasonStatus(water("crane-prairie"), new Date("2026-11-02T19:00:00.000Z")),
    "the status is the app's own regulationSeasonStatus() for the pack's date");
  assert(JSON.stringify(crane.regulation.windows) === JSON.stringify({ from: app.ODFW_REGULATIONS["crane-prairie"].season.from, to: app.ODFW_REGULATIONS["crane-prairie"].season.to }),
    `and carries its season window so the Watch can re-evaluate it on a later day (${JSON.stringify(crane.regulation.windows)})`);
  assert(crane.regulation.year === app.ODFW_REGULATIONS_META.year && typeof crane.regulation.stale === "boolean", "with the booklet year and whether the rules may be out of date");
  const oct = packOn("2026-10-30T19:00:00.000Z")["crane-prairie"];
  assert(oct.regulation.status === "open" && JSON.stringify(oct.regulation.windows) === JSON.stringify(crane.regulation.windows),
    "a pack built Oct 30 reads open, with the same window the Watch will close on Nov 1");

  const lower = nov["lower-deschutes"];
  const sections = app.ODFW_REGULATIONS["lower-deschutes"].season.sections;
  assert(Array.isArray(lower.regulation.windows?.sections) && lower.regulation.windows.sections.length === sections.length
    && lower.regulation.windows.sections.every((section, index) => section.name === sections[index].name),
    `a water with sections carries every section by name (${JSON.stringify(lower.regulation.windows)})`);
  const janLower = packOn("2027-01-15T19:00:00.000Z")["lower-deschutes"];
  assert(janLower.regulation.status === "partial" && janLower.regulation.label === context.regulationStatusLabel("partial"),
    `some sections closed reads partial (${janLower.regulation.status})`);

  assert(nov.crooked.regulation.status === context.regulationSeasonStatus(water("crooked"), new Date("2026-11-02T19:00:00.000Z")), "every water carries a regulation, open ones too");
  const openWater = Object.values(nov).find((item) => item.regulation.status === "open");
  assert(openWater && openWater.regulation.windows && openWater.regulation.label === context.regulationStatusLabel("open"), `an open water carries its window too (${openWater?.id})`);
  if (verifyId) {
    const verify = nov[verifyId];
    assert(verify.regulation.status === "unknown" && verify.regulation.windows === null && verify.regulation.label === app.REGULATION_STATUS_LABELS.unknown,
      `a verify water travels as unknown with no window, so the Watch never calls it open (${verifyId}: ${JSON.stringify(verify.regulation)})`);
  } else {
    assert(false, "the regulations table has a verify water to test with");
  }

  const cranePartial = context.seasonalClosureFor(water("crane-prairie"), "2000-11-15")?.partial === true;
  assert(crane.access && crane.access.snowedIn === false && crane.access.partial === cranePartial && crane.access.from === "11-15" && crane.access.to === "05-25"
    && crane.access.label.length > 0 && crane.access.typical.length > 0,
    `Nov 2 is before the typical OR-46 closure, but the window travels so the Watch can tell on Nov 20 (${JSON.stringify(crane.access)})`);
  const dec = packOn("2026-12-10T19:00:00.000Z")["hosmer"];
  assert(dec.access.snowedIn === true, `inside the window it is snowed in on the pack's date (${JSON.stringify(dec.access)})`);
  assert(nov.crooked.access === null, "a water with no snow closure carries none");
  assert(JSON.parse(JSON.stringify(context.buildWatchPack(new Date()))).waters.every((item) => "regulation" in item && "access" in item), "and both survive JSON");

  // A closure later marked partial is not snowed in.
  const closure = app.SEASONAL_ACCESS_CLOSURES.find((item) => item.waters.includes("hosmer"));
  closure.partial = true;
  const partial = packOn("2026-12-10T19:00:00.000Z")["hosmer"];
  delete closure.partial;
  assert(partial.access.partial === true && partial.access.snowedIn === false, `a partial closure is carried as partial, not snowed in (${JSON.stringify(partial.access)})`);
  // A water seasonalClosureFor() reports as partial (another way in) is
  // carried as partial even on a day outside the window.
  const realClosureFor = context.seasonalClosureFor;
  context.seasonalClosureFor = (item, dateKey) => {
    const found = realClosureFor(item, dateKey);
    return found && item?.id === "hosmer" ? { ...found, partial: true } : found;
  };
  const partialOutside = packOn("2026-11-02T19:00:00.000Z")["hosmer"];
  const partialInside = packOn("2026-12-10T19:00:00.000Z")["hosmer"];
  context.seasonalClosureFor = realClosureFor;
  assert(partialOutside.access.partial === true && partialInside.access.partial === true && partialInside.access.snowedIn === false,
    `a per-water partial closure is carried as partial inside and outside its window (${JSON.stringify(partialOutside.access)})`);

  [...app.savedWatersNow()].forEach((id) => context.toggleSavedWater(id));
  savedBefore.forEach((id) => context.toggleSavedWater(id));
}

group("Apple Watch: catches merge once, in order, without moving anyone's index");
{
  const at = (iso) => new Date(iso).toISOString();
  const entry = (loggedAt, notes) => ({ loggedAt, date: "", time: "", waterName: "Crooked River", waterId: "crooked", fly: "Zebra Midge #18", fish: "", length: "", count: "1", notes, flow: "", temp: "" });
  const watchCatch = (watchId, loggedAt, extra = {}) => ({
    watchId, loggedAt, date: "x", time: "y", waterId: "crooked", waterName: "Crooked River", fly: "Zebra Midge #18",
    fish: "Redband Trout", length: "14.5", count: "1", notes: "", flow: "240 cfs", flowSource: "stale", temp: "53 F", tempSource: "measured", ...extra
  });

  const converted = context.watchCatchEntry(watchCatch("W-0001-AAAA", "2026-11-19T07:30:00.000Z"));
  assert(converted.date === context.zonedDateLabel(new Date("2026-11-19T07:30:00.000Z")) && converted.time === context.zonedTimeLabel(new Date("2026-11-19T07:30:00.000Z")),
    `a Watch catch is dated on Oregon's clock by the journal's own formatters (${converted.date} ${converted.time})`);
  assert(converted.loggedOn === "watch" && converted.watchId === "W-0001-AAAA", "and is marked as from the Watch, with its id");
  assert(converted.flowSource === "stale" && converted.flow === "240 cfs" && converted.tempSource === "measured", "its readings keep the provenance the Watch gave them");
  assert(converted.waterName === "Crooked River" && converted.length === "14.5" && converted.count === "1" && converted.notes === "" && converted.photoId === "",
    "with exactly the fields Fish on! writes");
  assert(context.watchCatchEntry(watchCatch("bad id!", "2026-11-19T07:30:00.000Z")) === null, "a malformed watchId is refused");
  assert(context.watchCatchEntry(watchCatch("W-0001-AAAB", "yesterday-ish")) === null, "a catch with no real time is refused");
  const unknownSource = context.watchCatchEntry(watchCatch("W-0001-AAAC", "2026-11-19T07:30:00.000Z", { flowSource: "live!", length: "huge", count: "0" }));
  assert(unknownSource.flowSource === "unavailable" && unknownSource.flow === "", "a reading with an unknown source is stored as unavailable, not guessed");
  assert(unknownSource.length === "" && unknownSource.count === "1", "a nonsense length is dropped and a count defaults to one");

  const a = entry(at("2026-06-21T17:00:00Z"), "a");
  const b = entry(at("2026-06-21T15:00:00Z"), "b");
  const c = { ...entry("", "c"), dateApproximate: true };
  const w1 = context.watchCatchEntry(watchCatch("W-0001-0001", at("2026-06-21T16:00:00Z")));
  const w2 = context.watchCatchEntry(watchCatch("W-0001-0002", at("2026-06-21T18:00:00Z")));
  const merged = context.mergeWatchCatches([a, b, c], [w1, w2, { ...w1 }]);
  assert(merged.logs.map((item) => item.notes || item.watchId).join(",") === "W-0001-0002,a,W-0001-0001,b,c",
    `catches land in loggedAt order, newest first (${merged.logs.map((item) => item.notes || item.watchId).join(",")})`);
  assert(merged.added.length === 2, "a repeated id in one delivery is added once");
  assert(merged.logs.indexOf(a) < merged.logs.indexOf(b) && merged.logs.indexOf(b) < merged.logs.indexOf(c), "existing entries keep their order and identity");
  const again = context.mergeWatchCatches(merged.logs, [w1, w2]);
  assert(again.added.length === 0 && again.logs.length === merged.logs.length, "a second delivery of the same ids adds nothing");

  const posted = [];
  context.webkit = { messageHandlers: { riseWatch: { postMessage: (message) => posted.push(JSON.parse(JSON.stringify(message))) } } };
  app.setLogs([a, b, c]);
  app.setEditingLogIndex(1);
  context.riseWatchCatches({ catches: [watchCatch("W-0002-0001", at("2026-06-21T18:30:00Z")), watchCatch("W-0002-0002", at("2026-06-21T16:30:00Z"))] });
  const logs = app.getLogs();
  assert(logs.length === 5 && logs.filter((item) => item.loggedOn === "watch").length === 2, "delivered catches are in the journal");
  assert(logs[app.editingLogIndexNow()] === b, `an open edit form still points at the catch it was editing (index ${app.editingLogIndexNow()})`);
  const ack = posted.filter((message) => message.action === "catchesSaved");
  assert(ack.length === 1 && ack[0].ids.sort().join(",") === "W-0002-0001,W-0002-0002", `both are acknowledged after the write (${JSON.stringify(ack)})`);
  context.riseWatchCatches({ catches: [watchCatch("W-0002-0001", at("2026-06-21T18:30:00Z"))] });
  assert(app.getLogs().length === 5, "redelivery adds nothing");
  assert(posted.filter((message) => message.action === "catchesSaved").length === 2, "but is acknowledged again, so the container can let go of it");
  app.setEditingLogIndex(null);
  const ackedStored = JSON.parse(localStorage.getItem(app.WATCH_ACKED_KEY) || "[]");
  assert(ackedStored.includes("W-0002-0001") && ackedStored.includes("W-0002-0002"), `acknowledged ids are remembered (${JSON.stringify(ackedStored)})`);

  // Deleted on the phone, then delivered again: acknowledged, not re-inserted.
  app.setLogs(app.getLogs().filter((item) => item.watchId !== "W-0002-0001"));
  posted.length = 0;
  context.riseWatchCatches({ catches: [watchCatch("W-0002-0001", at("2026-06-21T18:30:00Z"))] });
  assert(app.getLogs().length === 4 && !app.getLogs().some((item) => item.watchId === "W-0002-0001"), "a catch deleted on the phone is not re-inserted when delivered again");
  const reAck = posted.filter((message) => message.action === "catchesSaved");
  assert(reAck.length === 1 && reAck[0].ids.join(",") === "W-0002-0001", `but it is acknowledged again, so neither device keeps offering it (${JSON.stringify(reAck)})`);
  posted.length = 0;
  context.riseWatchCatches({ catches: [watchCatch("W-0002-0001", at("2026-06-21T18:30:00Z")), watchCatch("W-0002-0003", at("2026-06-21T18:45:00Z"))] });
  assert(app.getLogs().length === 5 && app.getLogs().some((item) => item.watchId === "W-0002-0003") && !app.getLogs().some((item) => item.watchId === "W-0002-0001"),
    "a new catch in the same delivery still lands");
  assert(posted.filter((message) => message.action === "catchesSaved")[0]?.ids.sort().join(",") === "W-0002-0001,W-0002-0003", "and both are acknowledged");
  localStorage.setItem(app.WATCH_ACKED_KEY, JSON.stringify(Array.from({ length: app.WATCH_ACKED_MAX + 20 }, (_, index) => `W-9999-${String(index).padStart(4, "0")}`)));
  context.riseWatchCatches({ catches: [watchCatch("W-0002-0003", at("2026-06-21T18:45:00Z"))] });
  const capped = JSON.parse(localStorage.getItem(app.WATCH_ACKED_KEY));
  assert(capped.length === app.WATCH_ACKED_MAX && capped[capped.length - 1] === "W-0002-0003", `the remembered ids are capped, newest kept (${capped.length})`);
  localStorage.removeItem(app.WATCH_ACKED_KEY);

  const realSetItem = localStorage.setItem;
  posted.length = 0;
  localStorage.setItem = (key, value) => {
    if (key === "riseLogs") throw new Error("QuotaExceededError");
    return realSetItem.call(localStorage, key, value);
  };
  context.riseWatchCatches({ catches: [watchCatch("W-0003-0001", at("2026-06-21T19:00:00Z"))] });
  localStorage.setItem = realSetItem;
  assert(app.getLogs().length === 5 && !app.getLogs().some((item) => item.watchId === "W-0003-0001"), "a failed write adds nothing");
  assert(!posted.some((message) => message.action === "catchesSaved"), "and acknowledges nothing, so the container keeps the catch");
  assert(app.watchNoticeNow()?.error === true && /could not be saved/.test(app.watchNoticeNow().text), `and says so (${app.watchNoticeNow()?.text})`);

  app.setLogStorageUnreadable(true);
  context.riseWatchCatches({ catches: [watchCatch("W-0003-0002", at("2026-06-21T19:00:00Z"))] });
  assert(!posted.some((message) => message.action === "catchesSaved"), "an unreadable journal acknowledges nothing");
  assert(/could not be read/.test(app.watchNoticeNow()?.text || ""), "and says why");
  app.setLogStorageUnreadable(false);

  context.webkit = undefined;
  app.setLogs([]);
}

group("Audit round 2 (A4, A9, A10): the week planner's summary, partial access and today's best day");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const summary = context.plannerSummaryLine;
  assert(summary({ best: null, days: [] }) === "No forecast", "no forecast says so");
  assert(summary({ best: null, days: [{ regulationClosed: true }, { regulationClosed: true }] }) === "Closed season (ODFW) all week",
    "a week closed by the ODFW season says so, not snowed in");
  assert(summary({ best: null, days: [{ closure: {} }, { closure: {} }] }) === "Typically snowed in all week", "an all-snow week says snowed in");
  assert(summary({ best: null, days: [{ regulationClosed: true }, { closure: {} }] }) === "Closed or snowed in all week", "a mixed week says both");
  assert(summary({ best: null, days: [{ score: 6 }] }) === "No open day this week", "a week whose only open day is over has no best day");

  // Whychus in November: every day is closed by ODFW, none by snow.
  const coords = app.waterCoordinates.whychus;
  app.setNwsGrid(`${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`, "https://api.weather.gov/gridpoints/PDT/31,77/forecast/hourly");
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/31,77/forecast": { fetchedAt: new Date().toISOString(),
    days: ["2026-11-20", "2026-11-21", "2026-11-22"].map((date) => ({ date, highF: 45, windMph: 6, forecast: "Cloudy" })) } });
  const whychusPlan = context.plannerForWater(water("whychus"), "2026-11-20");
  assert(summary(whychusPlan) === "Closed season (ODFW) all week", `Whychus in November reads closed season (${summary(whychusPlan)})`);

  // A9: Crane Prairie keeps a south way in; the OR-46 window is partial for it.
  const crane = water("crane-prairie");
  const access = context.seasonalClosureFor(crane, "2026-05-01");
  assert(access?.id === "cascade-lakes-highway" && access.partial === true && access.accessNote === "north access typically closed",
    `Crane Prairie's closure is partial (${JSON.stringify(access && { partial: access.partial, note: access.accessNote })})`);
  assert(context.snowedInClosureFor(crane, "2026-05-01") === null && context.snowedInClosureFor(water("hosmer"), "2026-05-01") !== null,
    "a partial closure is not snowed in; a full one is");
  const craneCoords = app.waterCoordinates["crane-prairie"];
  app.setNwsGrid(`${craneCoords.lat.toFixed(4)},${craneCoords.lon.toFixed(4)}`, "https://api.weather.gov/gridpoints/PDT/20,30/forecast/hourly");
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/20,30/forecast": { fetchedAt: new Date().toISOString(),
    days: ["2026-04-21", "2026-04-22", "2026-04-23"].map((date) => ({ date, highF: 55, windMph: 6, forecast: "Cloudy" })) } });
  const cranePlan = context.plannerForWater(crane, "2026-04-21");
  assert(cranePlan.days[0].score === null && cranePlan.days[0].regulationClosed, "Apr 21 is still closed by ODFW");
  assert(cranePlan.days[1].score !== null && cranePlan.days[1].closure === null && /north access typically closed$/.test(cranePlan.days[1].reason),
    `from Apr 22 the season is open and the day is scored, saying which access is closed (${cranePlan.days[1].reason})`);
  assert(cranePlan.best && cranePlan.best.date >= "2026-04-22", "and can be the best day");
  assert(context.waterClosedLabel(crane, "2026-05-01") === "", "Crane Prairie in May is not labelled closed or snowed in");

  // A10: today is not the best day once its fishing is over.
  const metolius = water("metolius");
  const realKey = context.pacificDateKey;
  const realHour = context.currentHour;
  context.pacificDateKey = (date) => (date ? realKey(date) : "2026-07-10");
  const mCoords = app.waterCoordinates.metolius;
  app.setNwsGrid(`${mCoords.lat.toFixed(4)},${mCoords.lon.toFixed(4)}`, "https://api.weather.gov/gridpoints/PDT/30,60/forecast/hourly");
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/30,60/forecast": { fetchedAt: new Date().toISOString(),
    days: [{ date: "2026-07-10", highF: 70, windMph: 6, forecast: "Mostly Cloudy" }, { date: "2026-07-11", highF: 70, windMph: 25, forecast: "Sunny" }] } });
  const window = context.primeWindowHours(metolius);
  context.currentHour = () => (window ? window[0] : 9);
  assert(context.plannerForWater(metolius, "2026-07-10").best?.date === "2026-07-10", "before the window ends, today can be the best day");
  context.currentHour = () => (window ? window[1] : 17);
  const evening = context.plannerForWater(metolius, "2026-07-10");
  assert(evening.best?.date === "2026-07-11", `after the window ends, the best day is a later one (${evening.best?.date})`);
  assert(evening.days[0].score !== null, "today keeps its score; it is just not offered as the best day");
  context.currentHour = realHour;
  context.pacificDateKey = realKey;
  app.setPlannerForecasts({});
}

group("Audit round 2 (D2, D10, D11): a typically snowed-in or closed water is never presented as fishable");
{
  const water = (id) => app.waters.find((item) => item.id === id);
  const ids = ["east-lake", "paulina", "paulina-creek"];
  for (const id of ids) {
    assert(context.seasonalClosureFor(water(id), "2026-01-15")?.id === "newberry-caldera", `${id} is behind the Newberry gate in January`);
    assert(context.seasonalClosureFor(water(id), "2026-07-04") === null, `${id} is open in July`);
  }
  assert(context.seasonalClosureFor(water("east-lake"), "2026-11-14") === null && context.seasonalClosureFor(water("east-lake"), "2026-11-15") !== null,
    "the Newberry window typically starts mid-November");
  assert(context.seasonalClosureFor(water("east-lake"), "2026-05-25") !== null && context.seasonalClosureFor(water("east-lake"), "2026-05-26") === null,
    "and ends at Memorial Day weekend");
  const newberry = app.SEASONAL_ACCESS_CLOSURES.find((closure) => closure.id === "newberry-caldera");
  assert(/typically/i.test(newberry.typical) && /10 Mile Sno-Park/.test(newberry.typical), `the closure is worded as typical and names the gate (${newberry.typical})`);

  const realKey = context.pacificDateKey;
  for (const day of ["2026-11-19", "2026-12-15", "2027-02-10"]) {
    context.pacificDateKey = (date) => (date ? realKey(date) : day);
    const ranked = context.rankedWatersForCurrentMode(app.waters);
    const group = (item) => (context.regulationSeasonStatus(item, day) === "closed" ? 2 : context.snowedInClosureFor(item, day) ? 1 : 0);
    const groups = ranked.map(group);
    assert(groups.every((value, index) => index === 0 || value >= groups[index - 1]),
      `${day}: reachable open waters rank first, then snowed-in, then closed-season ones`);
    const top = context.topRecommendedWater();
    assert(group(top) === 0, `${day}: the top pick is reachable and open (${top.id})`);
    assert(!["east-lake", "hosmer", "paulina"].includes(top.id), `${day}: not East Lake, Hosmer or Paulina`);
  }
  context.pacificDateKey = (date) => (date ? realKey(date) : "2026-11-19");
  const hosmer = water("hosmer");
  const ranked = context.rankedWatersForCurrentMode(app.waters);
  const reachable = ranked.filter((item) => context.regulationSeasonStatus(item, "2026-11-19") !== "closed" && !context.snowedInClosureFor(item, "2026-11-19")).length;
  assert(ranked.indexOf(hosmer) >= reachable, `Hosmer on Nov 19 ranks after every reachable water (#${ranked.indexOf(hosmer) + 1}, ${reachable} reachable)`);
  assert(context.fishabilitySummary(hosmer) === "Typically snowed in", `and is labelled (${context.fishabilitySummary(hosmer)})`);
  const card = context.waterRankCard(hosmer, 9);
  assert(/regs-flag regs-snow/.test(card) && /Typically snowed in - check ODOT TripCheck \/ USFS/.test(card), "its rank card carries the snowed-in flag");
  assert(!/Prime window|passed for today|now, until/.test(card.match(/water-summary-row[\s\S]*?<\/div>/)?.[0] || ""), "and shows no prime window");
  const chip = context.waterChipCard("hosmer", "Saved");
  assert(/Typically snowed in/.test(chip), "a saved-water chip says it is snowed in");
  context.pacificDateKey = (date) => (date ? realKey(date) : "2026-11-18");
  const craneChip = context.waterChipCard("crane-prairie", "Recent");
  assert(/Closed season \(ODFW\)/.test(craneChip), "a recent-water chip for a closed water says so");
  assert(/Closed season \(ODFW\)/.test(context.whyThisWaterCard(water("crane-prairie"))), "and so does the why-this-water card");
  assert(context.waterChipCard("crooked", "Saved").indexOf("regs-flag") === -1, "an open water's chip carries no flag");
  assert(context.primeWindowOrClosed(water("crane-prairie")) === "Closed season (ODFW)", "a closed water has no prime window to show");

  // Trip hero for a closed water.
  const realActive = context.getWater;
  context.getWater = () => water("crane-prairie");
  context.renderTrip();
  const trip = elementFor("#trip").innerHTML;
  const hero = trip.match(/<section class="trip-hero[\s\S]*?<\/section>/)?.[0] || "";
  assert(/trip-closed-flag">Closed season \(ODFW\)/.test(hero) && /Fishability if open/.test(hero), "the Trip hero labels a closed water");
  const now = trip.match(/trip-card trip-now[\s\S]*?<\/strong>/)?.[0] || "";
  assert(/Closed season \(ODFW\)/.test(now) && !/now, until|passed for today|\d (AM|PM)-/.test(now), `and its prime-window card counts down nothing (${now.replace(/\s+/g, " ").slice(-80)})`);
  context.getWater = realActive;

  // Today hero for a closed home water, and command cards for a closed top pick.
  const realHome = context.getHomeWater;
  const realTop = context.topRecommendedWater;
  context.getHomeWater = () => water("crane-prairie");
  context.renderToday();
  let today = elementFor("#today").innerHTML;
  const title = today.match(/<h1 class="prime-title">([\s\S]*?)<\/h1>/)?.[1] || "";
  assert(title === "Crane Prairie Reservoir: Closed season (ODFW)" || /: Closed season \(ODFW\)$/.test(title), `a closed home water's headline is the closure, not a prime window (${title})`);
  assert(!/Best option now<\/span>[\s\S]*?Closed season/.test(today.match(/command-card primary[\s\S]*?<\/div>/)?.[0] || ""), "an open top pick's card is not labelled closed");
  context.topRecommendedWater = () => water("crane-prairie");
  context.renderToday();
  today = elementFor("#today").innerHTML;
  const best = today.match(/<div class="command-card primary"[^>]*data-go="waters">[\s\S]*?<\/div>/)?.[0] || "";
  assert(/Every water on your list is closed/.test(best) && /Closed season \(ODFW\) - /.test(best), `when even the top pick is closed the card says so (${best.replace(/\s+/g, " ").slice(0, 160)})`);
  assert(!/Fish Crane Prairie/.test(today), "and Trip mode does not say Fish it");
  context.topRecommendedWater = realTop;
  context.getHomeWater = realHome;
  context.pacificDateKey = realKey;
}

group("Audit round 2 (D14): recommendation reasons quote only usable, measured readings");
{
  const deschutes = app.waters.find((item) => item.id === "lower-deschutes");
  const hosmer = app.waters.find((item) => item.id === "hosmer");
  const old = new Date(Date.now() - 24 * 45 * 3600000).toISOString();
  const savedDeschutes = app.liveReports.byWater[deschutes.id];
  const savedHosmer = app.liveReports.byWater[hosmer.id];
  app.liveReports.byWater[deschutes.id] = { status: "ready", fromCache: true, cachedAt: old, usgs: { flow: "1,500 cfs", waterTemp: "41 F" }, nws: { forecast: "Cloudy", wind: "20 mph" } };
  const reason = context.liveRecommendationReason(deschutes);
  assert(!/1,500 cfs|Adjusted from|41 F/.test(reason), `an expired report is not quoted (${reason})`);
  assert(/too old/.test(reason), "and the reason says why");
  app.liveReports.byWater[hosmer.id] = { status: "ready", fromCache: true, cachedAt: old, usgs: {}, nws: { forecast: "Cloudy", wind: "20 mph" } };
  assert(/^Low light and edges/.test(context.flyRecommendationReason(hosmer, "Balanced Leech #10")), "an expired forecast's wind does not pick the wind-lane reason");
  delete app.liveReports.byWater[hosmer.id];
  const seedWind = hosmer.wind;
  hosmer.wind = "15 mph W";
  assert(/^Low light and edges/.test(context.flyRecommendationReason(hosmer, "Balanced Leech #10")), "nor does the seed wind");
  assert(!/58 F/.test(context.flyRecommendationReason(hosmer, "Chironomid #16")), "and the seed water temperature is not quoted as today's");
  app.liveReports.byWater[hosmer.id] = { status: "ready", cachedAt: new Date().toISOString(), usgs: {}, nws: { forecast: "Cloudy", wind: "15 mph" } };
  assert(/^Wind lanes/.test(context.flyRecommendationReason(hosmer, "Balanced Leech #10")), "a current measured wind still does");
  hosmer.wind = seedWind;
  if (savedHosmer) app.liveReports.byWater[hosmer.id] = savedHosmer; else delete app.liveReports.byWater[hosmer.id];
  if (savedDeschutes) app.liveReports.byWater[deschutes.id] = savedDeschutes; else delete app.liveReports.byWater[deschutes.id];
}

group("Audit round 2 (A1, A5, A6, A8): alerts ask, pause and load what they need");
{
  const posted = [];
  context.webkit = { messageHandlers: { riseAlerts: { postMessage: (message) => posted.push(JSON.parse(JSON.stringify(message))) } } };
  for (const id of ["lower-deschutes", "metolius"]) if (!app.savedWatersNow().includes(id)) context.toggleSavedWater(id);

  // A8: a toggle over an invalid range sends no rule; the edit that makes
  // it valid asks for permission.
  context.setAlertField("lower-deschutes", "flowMin", "5000");
  context.setAlertField("lower-deschutes", "flowMax", "4000");
  posted.length = 0;
  context.toggleAlert("lower-deschutes", "flow");
  assert(posted[0]?.action === "setRules" && !posted[0].rules.some((rule) => rule.waterId === "lower-deschutes"), "an invalid range sends no flow rule");
  posted.length = 0;
  context.setAlertField("lower-deschutes", "flowMax", "6000");
  assert(posted[0]?.action === "setRules" && posted[0].requestPermission === true && posted[0].rules.some((rule) => rule.waterId === "lower-deschutes"),
    `the edit that makes it valid asks for permission (${JSON.stringify(posted[0])?.slice(0, 120)})`);
  context.riseAlertsResult({ action: "permission", status: "denied" });
  posted.length = 0;
  context.setAlertField("lower-deschutes", "flowMax", "6100");
  assert(posted[0]?.requestPermission === false, "once iOS has answered, an edit does not ask again");

  // A1: permission given later re-sends the great-day schedule.
  context.toggleAlert("metolius", "greatDay");
  const today = context.pacificDateKey();
  const addDays = (count) => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
  };
  const mCoords = app.waterCoordinates.metolius;
  app.setNwsGrid(`${mCoords.lat.toFixed(4)},${mCoords.lon.toFixed(4)}`, "https://api.weather.gov/gridpoints/PDT/30,60/forecast/hourly");
  app.setPlannerForecasts({ "https://api.weather.gov/gridpoints/PDT/30,60/forecast": { fetchedAt: new Date().toISOString(),
    days: [0, 1, 2].map((offset) => ({ date: addDays(offset), highF: 55, windMph: 8, forecast: "Cloudy" })) } });
  context.riseAlertsResult({ action: "permission", status: "notDetermined" });
  posted.length = 0;
  context.riseAlertsResult({ action: "permission", status: "notDetermined" });
  assert(posted.length === 0, "an unchanged permission posts nothing");
  context.riseAlertsResult({ action: "permission", status: "granted" });
  assert(posted.some((message) => message.action === "scheduleGreatDays" && message.waters.some((entry) => entry.waterId === "metolius")),
    "permission granted re-sends the great-day schedule the prompt may have swallowed");
  posted.length = 0;
  context.riseAlertsResult({ action: "permission", status: "granted" });
  assert(!posted.length, "and a repeated granted reply sends nothing again");
  assert(/postAlertsMessage\(\{ action: "status" \}\)/.test(html.slice(html.indexOf("function startDailyOpenSyncWatcher"), html.indexOf("function activateTab"))),
    "returning to the app asks for the permission status again");

  // A5: hiding a water pauses its alerts.
  const realOnline = context.navigator.onLine;
  context.navigator.onLine = false;
  posted.length = 0;
  context.toggleHiddenWater("metolius");
  assert(!context.alertRulesForNative().some((rule) => rule.waterId === "metolius"), "a hidden water's alerts are not sent to the container");
  assert(posted.some((message) => message.action === "setRules" && !message.rules.some((rule) => rule.waterId === "metolius")), "hiding it re-sends the rules without it");
  assert(!context.greatDayAlertWaters().some((item) => item.id === "metolius") && !context.greatDaySchedule().some((item) => item.waterId === "metolius"),
    "and it is not scheduled or fetched for");
  assert(app.alertRulesNow().metolius?.greatDay?.enabled === true, "but its rule is kept");
  assert(/Metolius \(hidden - alerts paused\)/.test(context.alertsOverview()), "the planner's list says its alerts are paused");
  assert(/alerts are paused/.test(context.alertEditor(app.waters.find((item) => item.id === "metolius"))), "and so does its editor");
  posted.length = 0;
  context.toggleHiddenWater("metolius");
  assert(context.alertRulesForNative().some((rule) => rule.waterId === "metolius" && rule.greatDay), "showing it again resumes its alerts");
  assert(posted.some((message) => message.action === "scheduleGreatDays"), "and re-sends its great days");
  context.navigator.onLine = realOnline;

  // A6: a load for another water during a load in flight still fetches it.
  const crooked = app.waters.find((item) => item.id === "crooked");
  const cCoords = app.waterCoordinates.crooked;
  app.setNwsGrid(`${cCoords.lat.toFixed(4)},${cCoords.lon.toFixed(4)}`, "https://api.weather.gov/gridpoints/PDT/50,50/forecast/hourly");
  app.setPlannerForecasts({});
  const realFetch = context.fetch;
  const fetched = [];
  context.fetch = async (url) => {
    fetched.push(String(url));
    await new Promise((done) => setTimeout(done, 20));
    const periods = [0, 1, 2].map((offset) => ({ startTime: `${addDays(offset)}T06:00:00-08:00`, isDaytime: true, temperature: 50, temperatureUnit: "F", windSpeed: "5 mph", shortForecast: "Cloudy" }));
    return { ok: true, status: 200, json: async () => ({ properties: { periods } }) };
  };
  const first = context.loadPlannerForecasts({ waterList: [app.waters.find((item) => item.id === "metolius")], render: false });
  const second = context.loadPlannerForecasts({ waterList: [crooked], render: false });
  await Promise.all([first, second]);
  assert(fetched.some((url) => url.includes("/50,50/forecast")) && context.plannerForWater(crooked).days.length > 0,
    `the second water is fetched after the first load finishes (${fetched.join(", ")})`);
  fetched.length = 0;
  await Promise.all([context.loadPlannerForecasts({ waterList: [crooked], render: false }), context.loadPlannerForecasts({ waterList: [crooked], render: false })]);
  assert(fetched.length === 0, `a fresh forecast is not fetched again (${fetched.length})`);
  context.fetch = realFetch;
  app.setPlannerForecasts({});

  context.toggleSavedWater("lower-deschutes");
  context.toggleSavedWater("metolius");
  context.webkit = undefined;
}

group("Audit round 2 (D3, D4, D6, D7, D8, D15): regulation text matches its source");
{
  const regs = app.ODFW_REGULATIONS;
  const water = (id) => app.waters.find((item) => item.id === id);
  const stream = regs.tumalo.summary.join(" ");
  assert(/Rainbow trout over 20 inches are considered steelhead in streams/.test(stream) && /only hatchery steelhead may be taken/.test(stream)
    && /No limit on size or number of brook or brown trout in streams unless noted under Exceptions/.test(stream),
    "the zone stream summary carries the steelhead and brook/brown trout rules");
  assert(/steelhead/.test(regs.tumalo.harvest) && /brook or brown/.test(regs.tumalo.harvest), `and so does its harvest line (${regs.tumalo.harvest})`);
  const contradicted = Object.entries(regs).filter(([, entry]) => {
    const text = [...entry.summary, entry.harvest].join(" ");
    return /No harvest of rainbow trout over 20 inches|no rainbow over 20/i.test(text) && /only 1 over 20 inches/.test(text);
  }).map(([id]) => id);
  assert(!contradicted.length, `no water says both "no rainbow over 20" and "only 1 over 20" (${contradicted.join(", ") || "none"})`);
  assert(!("zoneRules" in app.ODFW_REGULATIONS_META), "the unused zone rules list is gone");

  // D4: every eRegulations Central Zone fragment matches exactly once in
  // the page text, so Safari cannot scroll to another water's rule.
  const excerpt = readFileSync(join(root, "scripts/fixtures/eregulations-central-zone-2026.txt"), "utf8").split("\n").slice(1).join("\n").replace(/\s+/g, " ");
  const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fragmentCount = (url) => {
    const directive = decodeURIComponent(url.split("#:~:text=")[1] || "");
    const parts = directive.split(",");
    const suffix = parts.length > 1 && parts[parts.length - 1].startsWith("-") ? parts.pop().slice(1) : "";
    const pattern = new RegExp(`\\b${escapeRe(parts[0])}${suffix ? `\\s*${escapeRe(suffix)}` : ""}`, "gi");
    return (excerpt.match(pattern) || []).length;
  };
  const sources = Object.entries(regs).filter(([, entry]) => entry.source.startsWith("https://www.eregulations.com/oregon/fishing/central-zone#:~:text="));
  assert(sources.length > 20, `the Central Zone fragments are checked (${sources.length})`);
  const ambiguous = sources.filter(([, entry]) => fragmentCount(entry.source) !== 1).map(([id, entry]) => `${id}=${fragmentCount(entry.source)}`);
  assert(!ambiguous.length, `every fragment matches exactly once on the page (${ambiguous.join(", ") || "all unique"})`);
  assert(fragmentCount("https://www.eregulations.com/oregon/fishing/central-zone#:~:text=Metolius%20River") > 1, "a bare name that occurs earlier is caught by this check");

  // D6, D7: sections from the source.
  assert(context.regulationSeasonStatus(water("ochoco-creek"), "2026-12-01") === "partial", "Ochoco Creek above the reservoir closes after Oct 31");
  assert(context.regulationSeasonStatus(water("ochoco-creek"), "2026-06-01") === "open", "and is open in June");
  assert(context.regulationSeasonStatus(water("wickiup"), "2026-08-31") === "open", "Wickiup is wholly open through Aug 31");
  assert(context.regulationSeasonStatus(water("wickiup"), "2026-09-01") === "partial", "its Deschutes River Arm closes Sep 1");
  assert(context.regulationSeasonStatus(water("wickiup"), "2026-11-01") === "closed", "and the whole reservoir after Oct 31");
  // D8: the app summarises trout rules; steelhead is left to ODFW.
  assert(!regs["lower-deschutes"].summary.some((line) => /hatchery steelhead/.test(line)), "the Lower Deschutes summary affirms no steelhead season");
  // D15: Scout Lake has the same Metolius-basin doubt as Square Lake.
  assert(regs["scout-lake"].confidence === "verify" && /Lake Creek/.test(regs["scout-lake"].uncertain), "Scout Lake is verify, like Square Lake");
  const counts = Object.values(regs).reduce((memo, entry) => ({ ...memo, [entry.confidence]: (memo[entry.confidence] || 0) + 1 }), {});
  assert(counts.confirmed === 51 && counts.verify === 11, `51 confirmed and 11 verify (${counts.confirmed}, ${counts.verify})`);
  const doc = readFileSync(join(root, "docs/odfw-regulations-2026.md"), "utf8");
  assert(/51 `confirmed`, 11 `verify`/.test(doc), "the audit document states the same counts");
}

group("Audit round 2, batch 2: the journal, On the water and Snap a bug");
{
  const run = (code) => vm.runInContext(code, context);
  const action = (selector) => app.clickActions.find(([name]) => name === selector)[1];
  const crooked = app.waters.find((water) => water.id === "crooked");
  const entry = (overrides = {}) => ({
    loggedAt: "2026-06-21T18:00:00.000Z", date: "Jun 21, 2026", time: "6:00 PM",
    waterName: "Crooked River", waterId: "crooked", fly: "Zebra Midge #18", fish: "Redband Trout",
    length: "", count: "1", notes: "", flow: "240 cfs", flowSource: "measured", temp: "53 F", tempSource: "measured",
    photoId: "", photo: "", ...overrides
  });
  const dirty = () => run("[...dirtyScreens]");
  const clearDirty = () => run("dirtyScreens.clear()");
  run("saveActiveWater('crooked')");

  // B1: deleting from the Log screen marks every screen the journal feeds.
  app.setLogs([entry({ notes: "A" }), entry({ notes: "B" })]);
  clearDirty();
  action("[data-delete-log]")({ dataset: { deleteLog: "0" } });
  const afterDelete = dirty();
  assert(app.getLogs().length === 1 && ["waters", "trip", "bugs", "log"].every((id) => afterDelete.includes(id)),
    `a Log-screen delete marks Waters, Trip, Bugs and Log stale, not only the Log (${afterDelete.join(", ")})`);
  assert(/renderScreens\("today", "waters", "trip", "bugs", "log"\);\n    \}\n\n    function syncSubscriptionStatus/.test(html),
    "a save from the Log screen repaints every screen the journal feeds");

  // B6: Worked/Ignore on a fly card marks Trip stale, where the same card is.
  clearDirty();
  action("[data-fly-feedback]")({ dataset: { flyFeedback: "Test Fly #99", feedbackValue: "ignored" } });
  assert(dirty().includes("trip"), `Worked/Ignore repaints Trip's fly cards (${dirty().join(", ")})`);
  run("delete flyFeedback['Test Fly #99']; writeStoredObject(FLY_FEEDBACK_KEY, flyFeedback)");

  // B4: editing a catch with no species or fly keeps both blank.
  app.setLogs([entry({ fish: "", fly: "" })]);
  run("editingLogIndex = 0; logFormOpen = true");
  context.renderLog();
  const logMarkup = elementFor("#log").innerHTML;
  const fishSelect = (logMarkup.match(/<select name="fish">[\s\S]*?<\/select>/) || [""])[0];
  assert(/<option value="" selected>Species not set<\/option>/.test(fishSelect) && (fishSelect.match(/selected/g) || []).length === 1,
    "editing a catch with no species selects \"Species not set\", not Redband Trout");
  assert(/<input name="fly" value="" /.test(logMarkup), "and leaves its fly blank instead of filling in the water's default fly");
  run("editingLogIndex = 0");
  context.renderLog();
  app.setLogs([entry({ fish: "Brown Trout", fly: "" })]);
  context.renderLog();
  assert(!/Species not set<\/option>/.test(elementFor("#log").innerHTML), "a catch with a species offers no blank option");
  run("editingLogIndex = null");
  context.renderLog();
  const newForm = elementFor("#log").innerHTML;
  assert(!/Species not set<\/option>/.test(newForm) && !/<input name="fly" value="" /.test(newForm),
    "a new catch still starts from the water's fly and a species");
  run("logFormOpen = false");

  // B9: switching the form to an edit drops a Snap a bug photo held for a new catch.
  run("pendingCatchPhoto = 'data:image/jpeg;base64,AAAA'");
  action("[data-edit-log]")({ dataset: { editLog: "0" } });
  assert(run("pendingCatchPhoto") === "", "Edit releases a bug photo attached to a new-catch draft");
  run("pendingCatchPhoto = 'data:image/jpeg;base64,AAAA'; lastFishOnEntry = getLogs()[0]");
  context.openFishOnDetails();
  assert(run("pendingCatchPhoto") === "", "and so does Fish on!'s Add details");
  run("editingLogIndex = null; logFormOpen = false; lastFishOnEntry = null");

  // B7: the fly list is frozen for the session and the position counts up.
  app.setLogs([]);
  run("openOnWater()");
  const order = run("onWaterFlies(waterById('crooked'))").slice();
  const worked = order[1];
  run(`flyFeedback[${JSON.stringify(worked)}] = "worked"`);
  const positions = [];
  const shown = [];
  for (let step = 0; step < order.length; step += 1) {
    context.renderTrip();
    const markup = elementFor("#trip").innerHTML;
    positions.push((markup.match(/Next fly to try - (\d+) of (\d+)/) || []).slice(1).join("/"));
    shown.push(context.onWaterCurrentFly(crooked));
    context.nextOnWaterFly("crooked");
  }
  assert(positions.join(",") === order.map((fly, index) => `${index + 1}/${order.length}`).join(","),
    `"Next fly to try" counts 1 of N, 2 of N... (${positions.join(", ")})`);
  assert(shown.join("|") === order.join("|"), "and walks the order frozen when the view opened, with no fly sliding in");
  assert(context.onWaterCurrentFly(crooked) === order[0], "after the last fly it comes round to the first");
  assert(run(`flyFeedback[${JSON.stringify(worked)}]`) === "worked", `"Not working" leaves a fly marked Worked as Worked (${worked})`);
  assert(order.filter((fly) => fly !== worked).every((fly) => run(`flyFeedback[${JSON.stringify(fly)}]`) === "ignored"),
    "and still marks the others ignored, as documented");
  run("Object.keys(flyFeedback).forEach((fly) => delete flyFeedback[fly]); writeStoredObject(FLY_FEEDBACK_KEY, flyFeedback)");
  // A fly proven on this water by the journal is skipped, never ignored.
  const proven = order[0];
  app.setLogs([1, 2, 3].map((index) => entry({ fly: proven, notes: `p${index}`, loggedAt: `2026-06-2${index}T18:00:00.000Z` })));
  run("openOnWater()");
  const provenFirst = context.onWaterCurrentFly(crooked);
  context.nextOnWaterFly("crooked");
  assert(provenFirst === proven && run(`flyFeedback[${JSON.stringify(proven)}]`) === undefined && context.onWaterCurrentFly(crooked) !== proven,
    `a fly proven here is skipped for the session without being marked ignored (${proven})`);
  run("Object.keys(flyFeedback).forEach((fly) => delete flyFeedback[fly]); writeStoredObject(FLY_FEEDBACK_KEY, flyFeedback)");
  app.setLogs([]);

  // B8: the locate button's disabled attribute is an attribute.
  run("onWaterLocating = true");
  context.renderTrip();
  assert(/data-on-water-locate disabled>/.test(elementFor("#trip").innerHTML) && !/data-on-water-locatedisabled/.test(elementFor("#trip").innerHTML),
    "while locating, the button renders as disabled, not as data-on-water-locatedisabled");
  run("onWaterLocating = false");

  // B5: a rough fix, a late fix and the fix age.
  const geolocation = context.navigator.geolocation;
  let pending = null;
  let options = null;
  context.navigator.geolocation = { getCurrentPosition(success, failure, opts) { pending = { success, failure }; options = opts; } };
  const metolius = app.waterCoordinates.metolius;
  const fix = (accuracy) => ({ coords: { latitude: metolius.lat + .0005, longitude: metolius.lon, accuracy } });
  context.locateOnWater();
  assert(options?.maximumAge === 0, `"Which water am I on?" asks for a fresh fix (maximumAge ${options?.maximumAge})`);
  pending.success(fix(8000));
  assert(run("activeWater") === "crooked" && /too rough/.test(run("onWaterNotice")),
    `an 8 km fix picks no water and says why (${run("onWaterNotice")})`);
  context.locateOnWater();
  const late = pending;
  context.closeOnWater();
  late.success(fix(15));
  assert(run("activeWater") === "crooked" && run("onWaterNotice") === "" && run("onWaterLocating") === false,
    "a fix that arrives after Exit changes nothing");
  run("openOnWater()");
  context.locateOnWater();
  const failedLate = pending;
  context.closeOnWater();
  failedLate.failure({ code: 3 });
  assert(run("onWaterNotice") === "", "and neither does a failure that arrives after Exit");
  run("openOnWater()");
  context.locateOnWater();
  pending.success(fix(15));
  assert(run("activeWater") === "metolius" && /You look to be on/.test(run("onWaterNotice")), "a precise fix still finds the water");
  context.closeOnWater();
  context.navigator.geolocation = geolocation;
  run("saveActiveWater('crooked')");

  // B10: a legacy entry known only by name keeps its readings when its water is unchanged.
  assert(/const originalWaterId = \(waterById\(original\.waterId\) \|\| waters\.find\(\(item\) => item\.name === original\.waterName\)\)\?\.id;/.test(html)
    && /if \(waterField && waterField !== originalWaterId\)/.test(html),
    "an edit compares the chosen water with the water the entry resolves to");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
