# ODFW fishing regulations for the app's waters - 2026 booklet

Research notes behind `ODFW_REGULATIONS` in `the-rise-app.html`. Every fact in
the app's regulations table is listed here with the line of the source it came
from, so a human can audit it line by line.

- **Checked:** 2026-11-18 (all pages below were read that day).
- **Regulation year:** 2026 Oregon Sport Fishing Regulations. The PDF metadata
  shows it was produced 2025-11-12; the eRegulations zone pages say
  "Last Updated: January 6, 2026".
- **Who checked it:** the app's maintainer, with an AI assistant. Nothing was
  filled in from memory. A water whose rule could not be confirmed from these
  sources is marked `verify`, and the notes say what is uncertain.

## Sources

| Source | URL | Used for |
| --- | --- | --- |
| eRegulations, Central Zone (ODFW's booklet text, HTML) | https://www.eregulations.com/oregon/fishing/central-zone | Zone rules and every Central Zone exception below |
| eRegulations, Willamette Zone | https://www.eregulations.com/oregon/fishing/willamette-zone | Clear Lake (McKenzie headwaters); Big Lake / Blue Lake zone check |
| eRegulations, Definitions | https://www.eregulations.com/oregon/fishing/definitions | "Fly-fishing", "artificial fly", "barbless hook", "wild fish" |
| 2026 booklet PDF (as hosted by eRegulations) | https://www.eregulations.com/assets/docs/resources/OR/26ORFW_LR.pdf | Cross-check of the HTML; Central Zone is booklet pp. 52-57 (PDF pp. 54-59), maps on PDF pp. 58-59 |
| ODFW regulation updates (in-season / emergency changes) | https://myodfw.com/articles/regulation-updates | Linked from the app, not encoded. Page dated November 3, 2026 |
| ODFW regulations home | https://myodfw.com/articles/oregon-fishing-hunting-regulations-and-updates | Linked from the app |
| ODFW Recreation Report, Central Zone | https://myodfw.com/recreation-report/fishing-report/central-zone | Linked from the app (thermal sanctuaries, conditions) |

Source links in the app use a URL text fragment (`#:~:text=...`) so Safari
scrolls to the water's heading on the eRegulations page. Every source link is
on `eregulations.com` or `myodfw.com`; the behaviour suite fails on any other
host.

## Central Zone general rules (apply unless an exception is listed)

From the Central Zone page, "Central Zone Regulations" table:

- Zone: all waters draining into the Columbia River from Bonneville Dam up to
  and including the Deschutes River.
- Streams: angling for all species is restricted to artificial flies and lures
  (see exceptions where bait is allowed).
- Trout, lakes: open all year. 5 per day, 3 daily limits in possession.
- Trout, streams: open May 22 - Oct 31 unless noted under Exceptions. 2 per
  day, 3 daily limits in possession.
- Trout: 8 inch minimum length. Only 1 trout over 20 inches per day. Rainbow
  trout over 20 inches are considered steelhead in streams. No limit on size or
  number of brook or brown trout in streams unless noted. Closed to angling for
  bull trout unless noted under Exceptions.
- Kokanee: 10 per day unless noted. No size limit. Open all year.
- Bass, lakes: 5 per day, no more than 3 over 15 inches. Streams: no limit.
- Released trout, salmon and steelhead must be unharmed and should not be
  removed from the water.
- The lower Deschutes is a designated thermal angling sanctuary with possible
  extra rules Jul 15 - Sep 15 (check the Recreation Report). Not encoded.

Willamette Zone general trout rules (for Clear Lake): lakes open all year,
5 per day, 8 inch minimum, only 1 over 20 inches, closed to angling for bull
trout. Streams catch-and-release unless noted, open May 22 - Oct 31.

## In-season changes seen on 2026-11-18 (NOT encoded)

The ODFW updates page (Nov 3, 2026) lists, for the Central Zone, Deschutes
River closures to salmon/steelhead angling Aug 15 - Dec 31, 2026 (mouth to the
upper trestle: salmon and steelhead; trestle to Sherars Falls: steelhead;
Sherars Falls to the Pelton Reregulating Reservoir: steelhead and coho). These
are temporary and concern salmon and steelhead, not the trout rules the app
summarises, so the app links to the page instead of copying them.

## Per-water facts

`confirmed` = every stated fact is on the cited page. `zone rules` = the water
is not listed under Exceptions, so the zone's general rules above apply.
Section names are the booklet's own.

| App id | Water | Zone | Season (2026) | Facts | Source (fragment) | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| lower-deschutes | Lower Deschutes (Pelton Rereg. Dam to Maupin) | Central | Sections: Sherars Falls to N. boundary of Warm Springs Reservation open all year (trout, hatchery steelhead); N. boundary to Pelton Regulating Reservoir open Apr 22 - Dec 31 | 2 rainbow trout/day, 10" min, 13" max. No angling from a floating device. Closed from Pelton Regulating Dam downstream ~600 ft to ODFW markers. Where the river borders the Reservation, anglers are restricted to the eastern half. Artificial flies and lures (zone stream rule; bait only below Sherars Falls, outside this reach). | CZ "Sherars Falls to Northern Boundary"; CZ "Confederated Tribes of Warm Springs" | confirmed |
| middle-deschutes | Middle Deschutes (Bend to Lake Billy Chinook) | Central | Open all year for trout ("Lake Billy Chinook to Benham Falls") | No harvest of rainbow trout over 20". Zone stream: 2 trout/day, 8" min, artificial flies and lures. | CZ "Lake Billy Chinook to Benham Falls" | confirmed |
| upper-deschutes | Upper Deschutes (Wickiup to Bend) | Central | Sections: Benham Falls down to Bend open all year (part of "LBC to Benham Falls"); Wickiup down to Benham Falls open May 22 - Sep 30 (part of "Benham Falls to Little Lava Lake") | Below Benham Falls: no harvest of rainbow over 20", zone 2/day 8". Above Benham Falls: 2 trout/day, 8" min, wild rainbow trout must be released. Artificial flies and lures. | CZ "Benham Falls to Little Lava Lake" | confirmed |
| metolius | Metolius River | Central | Sections: cable car crossing near mouth to Bridge 99/Lower Bridge (NF-1270) open all year, artificial flies and lures only; Bridge 99 to Allingham Campground Bridge (NF-1217) open all year, fly fishing only, barbless; above Allingham Campground Bridge open May 22 - Oct 31, fly fishing only, barbless | Catch-and-release for trout, including bull trout. Tributaries closed except Lake Cr (zone rules). | CZ "Metolius River" | confirmed |
| crooked | Crooked River below Bowman Dam | Central | Open all year | No harvest of rainbow trout over 20". Zone stream: 2/day, 8" min, artificial flies and lures. | CZ "Below Bowman Dam" | confirmed |
| fall-river | Fall River | Central | Sections: above Fall River Falls open all year; below the falls May 22 - Sep 30 | Fly fishing only, barbless hooks required. Wild rainbow trout must be released. | CZ "Fall River" | confirmed |
| whychus | Whychus Creek | Central | May 22 - Oct 31 (zone stream; no season exception listed) | No harvest of rainbow trout over 20". Zone stream: 2/day, 8" min, artificial flies and lures. | CZ "Whychus Creek" | confirmed |
| tumalo | Tumalo Creek | Central | May 22 - Oct 31 (zone stream) | Not listed under Exceptions: zone stream rules. | CZ zone table | confirmed |
| little-deschutes | Little Deschutes | Central | May 22 - Oct 31 (zone stream) | Not listed: zone stream rules. | CZ zone table | confirmed |
| crane-prairie | Crane Prairie Reservoir | Central | Apr 22 - Oct 31 | Wild rainbow trout must be released. Zone lake: 5 trout/day, 8" min, 1 over 20"; kokanee 10/day. | CZ "Crane Prairie Reservoir" | confirmed |
| east-lake | East Lake | Central | Open all year (zone lake) | Catch-and-release for tiger trout. Zone lake bag otherwise. | CZ "East Lake" | confirmed |
| paulina | Paulina Lake | Central | Open all year (zone lake) | Catch-and-release for tiger trout. Zone lake bag otherwise. | CZ "Paulina Lake" | confirmed |
| hosmer | Hosmer Lake | Central | Open all year (zone lake) | Catch-and-release for all species. Fly fishing only, barbless hooks required. | CZ "Hosmer Lake" | confirmed |
| lava | Lava Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. (On the Central Zone map.) | CZ zone table | confirmed |
| little-lava | Little Lava Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. The Deschutes River below it ("Benham Falls to Little Lava Lake") is open May 22 - Sep 30. | CZ zone table | confirmed |
| wickiup | Wickiup Reservoir | Central | Apr 22 - Oct 31 | Deschutes River Arm closed from Gull Point Campground boat ramp to ODFW markers near Sheeps Bridge Sep 1 - Apr 21; Deschutes River rules above those markers. Zone lake bag. | CZ "Wickiup Reservoir" | confirmed |
| davis | Davis Lake | Central | Open all year (zone lake) | Catch-and-release for trout. Fly fishing only, barbless hooks required. No limit on size or number of bass. Odell Cr channel defined as upstream to the boat ramp at West Davis Lake Campground. | CZ "Davis Lake and Odell Creek Channel" | confirmed |
| three-creek | Three Creek Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| north-twin | North Twin Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. (On the Central Zone map.) | CZ zone table | confirmed |
| south-twin | South Twin Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. (On the Central Zone map.) | CZ zone table | confirmed |
| cultus | Cultus Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| devils | Devils Lake (Cascade Lakes Hwy) | Central | Open all year (zone lake) | Not listed: zone lake rules. (The Devils Lake in the Northwest Zone booklet is the Lincoln City lake, a different water.) | CZ zone table | confirmed |
| suttle | Suttle Lake | Central | Open all year (zone lake) | 25 kokanee/day; kokanee/sockeye over 16" must be released; no limit on number or size of bass. Zone trout rules. | CZ "Suttle Lake" | confirmed |
| shevlin | Shevlin Pond | Central | Open all year (zone lake) | 2 fish per day. Youth (17 and under) and disabled anglers only. | CZ "Shevlin Pond" | confirmed |
| lake-billy-chinook | Lake Billy Chinook | Central | Sections: Metolius Arm open Mar 1 - Oct 31 (tribal angling permit required); balance of reservoir open all year (zone lake) | Trout limit may include 1 bull trout, 24" min; other bull trout released unharmed. Rainbow over 20" and kokanee/sockeye over 16" must be released. No limit on bass or brown trout. Closed from the cable car crossing on the Metolius to markers downstream. Stream rules above ODFW markers on the Crooked and Deschutes arms. | CZ "Lake Billy Chinook" | confirmed |
| simtustus | Lake Simtustus | Central | Open all year (zone lake; no season listed) | Confederated Tribes of Warm Springs angling permit required. No limit on size or number of bass. | CZ "Lake Simtustus" | confirmed |
| prineville-reservoir | Prineville Reservoir | Central | Open all year (zone lake) | 5 bass/day, only 1 over 15". Zone trout rules. | CZ "Prineville Reservoir" | confirmed |
| ochoco-reservoir | Ochoco Reservoir | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| haystack | Haystack Reservoir | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| blue-lake | Blue Lake (Santiam Pass) | Central? | Lakes open all year in both candidate zones | Two different "Blue" lakes: a Blue Lake by Suttle Lake is on the Central Zone map and is not listed (zone lake rules); a Willamette NF "Blue" lake is in the Willamette Zone "Cascade Lakes" exception (bait allowed, no limit on brook trout). Which one the app means is not confirmed. | CZ zone table; WZ "Cascade Lakes" | **verify** |
| big-lake | Big Lake (Santiam Pass) | Willamette? | Lakes open all year in both candidate zones | Not named in the Central or Willamette Zone exceptions, and its zone is not stated on either page. | CZ / WZ zone tables | **verify** |
| scout-lake | Scout Lake (Metolius basin) | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| clear-lake | Clear Lake (McKenzie headwaters) | Willamette | Open all year (zone lake) | Willamette Zone McKenzie River, "Above Tamolitch Falls (Blue Pool) including Carmen Reservoir and Clear Lake: Willamette Zone regulations apply, including no limit on the size or number of brook trout." Zone lake: 5 trout/day, 8" min, 1 over 20"; bull trout closed. (The "Clear Lake" on the Central Zone map is a different lake near Mt. Hood.) | WZ "Above Tamolitch Falls" | confirmed |
| walton | Walton Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| ollalie | Olallie Lake | Central | Open all year (zone lake) | Shown on the Central Zone map (PDF p. 58); not listed under Central or Willamette exceptions: zone lake rules. | CZ zone table | confirmed |
| deer-lake | Deer Lake (Cascade Lakes) | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| elkhorn-lake | Elkhorn Lake (Ochoco / Crooked River country) | ? | Not recorded | No "Elkhorn Lake" anywhere in the 2026 booklet; location and zone could not be confirmed. | - | **verify** |
| antelope-flat | Antelope Flat Reservoir | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| shelvock-pond | Shelvock Pond (Redmond) | ? | Not recorded | Not named anywhere in the 2026 booklet. Community ponds are often youth-only; could not confirm. | - | **verify** |
| pine-nursery | Pine Nursery Pond (Bend) | Central | Open all year (zone lake) | "Bend Pine Nursery Pond: 2 fish per day." No youth restriction listed. | CZ "Bend Pine Nursery Pond" | confirmed |
| hat-rock-pond | Hat Rock Pond (Redmond) | ? | Not recorded | Not named anywhere in the 2026 booklet. (Hat Rock State Park is near Umatilla, in the Northeast Zone.) | - | **verify** |
| spark-lake | Sparks Lake | Central | Open all year (zone lake) | "Sparks Lake and Tributaries, Mouth to Cascade Lake Hwy: Fly fishing only, barbless hooks required." Zone bag. | CZ "Sparks Lake and Tributaries" | confirmed |
| elk-lake | Elk Lake | Central | Open all year (zone lake) | 25 kokanee/day, no size limits. Zone trout rules. | CZ "Elk Lake" | confirmed |
| little-cultus | Little Cultus Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| crescent-lake | Crescent Lake | Central | Open all year (zone lake) | 1 lake trout/day, 24" min. Zone trout rules. | CZ "Crescent Lake" | confirmed |
| odell-lake | Odell Lake | Central | Apr 22 - Oct 31 | 25 kokanee/day, no size limits; 1 lake trout/day, 24" min; harvest of bull trout prohibited; closed between ODFW markers and the mouth of Trapper Cr and between markers and the Odell Cr outlet; closed to angling on tributaries. | CZ "Odell Lake" | confirmed |
| crescent-creek | Crescent Creek | Central | May 22 - Oct 31 (zone stream) | Not listed: zone stream rules. | CZ zone table | confirmed |
| spring-river | Spring River | Central | May 22 - Oct 31 (zone stream) | Not listed: zone stream rules. | CZ zone table | confirmed |
| paulina-creek | Paulina Creek | Central | May 22 - Oct 31 (zone stream) | Not listed: zone stream rules. | CZ zone table | confirmed |
| bridge-creek | Bridge Creek (Ochoco Mountains) | ? | Not recorded | Not named in the Central or Northeast Zone exceptions. A Bridge Creek in the Ochocos may drain to the John Day (Northeast Zone); a Bridge Creek near Bend drains to Tumalo Creek (Central). Which one, and its zone, not confirmed. | - | **verify** |
| ochoco-creek | Ochoco Creek (Prineville) | Central | Mouth to Ochoco Dam: open all year | No harvest of rainbow trout over 20". Zone stream: 2/day, 8" min, artificial flies and lures. Above Ochoco Reservoir the zone stream season (May 22 - Oct 31) applies. | CZ "Ochoco Creek" | confirmed |
| firemans-pond | Fireman's Pond (Redmond) | ? | Not recorded | Not named anywhere in the 2026 booklet; youth-only status not confirmed. | - | **verify** |
| prineville-youth | Prineville Youth Pond | Central | Open all year (zone lake) | 2 fish per day. Youth (17 and under) only. | CZ "Prineville Youth Pond" | confirmed |
| jefferson-county-pond | Jefferson County Pond | Central | Open all year (zone lake) | 2 fish per day. Youth (17 and under) and disabled anglers only. | CZ "Jefferson County Pond" | confirmed |
| todd-lake | Todd Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| blow-lake | Blow Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| doris-lake | Doris Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| lucky-lake | Lucky Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| rosary-lakes | Rosary Lakes | Central | Lakes open all year | Not listed. Odell Lake's entry says "Closed to angling on tributaries"; whether that reaches lakes in Odell's drainage is not stated. | CZ "Odell Lake" | **verify** |
| square-lake | Square Lake (Santiam Pass) | Central? | Lakes open all year | Not listed. The Metolius River entry closes its tributaries except Lake Cr; Square Lake's drainage and whether that applies are not confirmed. | CZ "Metolius River" | **verify** |
| little-three-creeks | Little Three Creeks Lake | Central | Open all year (zone lake) | Not listed: zone lake rules. | CZ zone table | confirmed |
| yoran-lake | Yoran Lake | Central | Lakes open all year | Not listed. Same Odell Lake tributary question as Rosary Lakes. | CZ "Odell Lake" | **verify** |

Totals: 62 waters. 52 `confirmed`, 10 `verify` (blue-lake, big-lake,
elkhorn-lake, shelvock-pond, hat-rock-pond, bridge-creek, firemans-pond,
rosary-lakes, square-lake, yoran-lake).

The app never computes a season status from a `verify` entry: its status is
`unknown`, it is labelled "Season not confirmed - check ODFW", and it is
neither ranked down nor treated as closed.

## Closed or partly closed on 2026-11-18 (Pacific)

- **Closed:** Whychus Creek, Tumalo Creek, Little Deschutes, Crescent Creek,
  Spring River, Paulina Creek (zone stream season ended Oct 31); Crane Prairie,
  Wickiup, Odell Lake (season ended Oct 31).
- **Partly open:** Upper Deschutes (open below Benham Falls), Metolius (open
  below Allingham Campground Bridge), Fall River (open above the falls), Lake
  Billy Chinook (Metolius Arm closed).
- Everything else confirmed is open; the 10 `verify` waters are `unknown`.

## Annual re-verification

See the "Fishing regulations" section of `README.md`.
