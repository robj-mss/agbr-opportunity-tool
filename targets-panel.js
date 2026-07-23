/* ===========================================================================
   MSS AGBR Opportunity Tool — Monthly Targets
   ---------------------------------------------------------------------------
   Replaces the Rep Opportunities tab. Store-anchored: each target is a store,
   with that store's core gaps across every vendor listed underneath. The rep
   marks an outcome per gap; the store row rolls those up.

   Reads VENDORS / storeOppCalc / skuWeeklyOpp / volFactor from the main file,
   so a new vendor line added to VENDORS appears here with no change to this
   code.

   Paste this block in place of renderRepOpps() and its helpers.
   =========================================================================== */

/* --- Configuration -------------------------------------------------------- */

var TARGET_REPS = [
  "Carla Hicks",
  "Diane Bruce",
  "Donna Willie",
  "Mike Barndt",
  "Natasha Palmer",
  "Ryan Stribling",
];

// How many stores each rep is assigned per month.
var TARGETS_PER_REP = 12;

// No rep should get a list that is one banner twelve times over. Cap how many
// stores of the same chain can appear, so the month spans the territory.
var MAX_PER_CHAIN = 4;

// A store in this data has ~100 open core gaps across six vendor lines, and
// the tail of that list is worth a few hundred dollars a year against a head
// worth tens of thousands. Showing all of it buries the gaps that matter and
// turns the list back into a browse. Each store shows its best gaps only.
var GAPS_PER_STORE = 8;

// Within that cap, guarantee the widest line doesn't take every slot — each
// vendor present at the store gets at least one row before the remainder is
// filled by dollar value.
var MIN_PER_VENDOR = 1;

// Focus areas reserved inside each store's visible gap list. The candidate-pool
// floor below gets a category into the running; this is what puts it in front
// of a rep. Without it, a low-priced line never clears the dollar sort — six
// Parfaits in the pool are still six Parfaits nobody sees.
//
// Costs a slot from the dollar-ranked remainder, so keep it small.
var STORE_FOCUS_FLOOR = [
  { vk: "rc", cat: "Parfaits &amp; Cups", slots: 1 },
];

// Some lines are too broad to target in full. Rich's carries 78 core SKUs,
// which crowds the ranking before the per-store trim ever runs. Capping the
// candidate pool keeps targets on the SKUs worth a conversation.
//
// This applies to targets only. Store Lookup, SKU Performance and the
// dashboard still show every SKU, so a rep can work past the list.
var VENDOR_SKU_CAP = { rc: 31 };

// Focus areas. A capped line still has to carry the categories MSS is pushing,
// even when their velocity doesn't earn the slots on its own. These are
// guaranteed a minimum number of places in the candidate set, taken by network
// 4-week revenue within the category.
//
// Rich's sits at 31 rather than 25 so the six Parfaits are additive: the
// focus area is carried without pushing out the cookie doughs and BetterCreme
// that the dollar ranking earns on its own.
//
// Keys must match the vendor's own category strings exactly.
var VENDOR_CAT_FLOOR = {
  rc: { "Parfaits &amp; Cups": 6 },
};

// Cached per vendor: the set of SKU ids eligible to become a target.
var _skuCapCache = {};

/*
 * The capped candidate set for a vendor, or null when the line isn't capped.
 * Ranked by network 4-week revenue, with one SKU from each category seeded
 * first so a broad line doesn't collapse to its two biggest categories.
 */
function cappedSkuIds(vk, m) {
  if (!(vk in VENDOR_SKU_CAP)) return null;
  if (_skuCapCache[vk]) return _skuCapCache[vk];

  var cap = VENDOR_SKU_CAP[vk];
  var core = m.skus.filter(function (sk) { return sk.status === "core"; });
  if (core.length <= cap) {
    _skuCapCache[vk] = null;
    return null;
  }

  var byVol = core.slice().sort(function (a, b) {
    return (b.r4w || 0) - (a.r4w || 0);
  });

  var picked = [];
  var seenCat = {};
  var floors = VENDOR_CAT_FLOOR[vk] || {};

  // Focus categories claim their guaranteed slots first.
  Object.keys(floors).forEach(function (cat) {
    var want = floors[cat];
    var inCat = byVol.filter(function (sk) { return (sk.cat || "_") === cat; });
    inCat.slice(0, want).forEach(function (sk) {
      if (picked.length < cap && picked.indexOf(sk) < 0) {
        picked.push(sk);
        seenCat[cat] = true;
      }
    });
  });

  // Seed: the best seller from each remaining category.
  byVol.forEach(function (sk) {
    var c = sk.cat || "_";
    if (!seenCat[c] && picked.length < cap) {
      seenCat[c] = true;
      picked.push(sk);
    }
  });

  // Fill the rest by volume.
  for (var i = 0; i < byVol.length && picked.length < cap; i++) {
    if (picked.indexOf(byVol[i]) < 0) picked.push(byVol[i]);
  }

  var ids = {};
  picked.forEach(function (sk) { ids[sk.id] = true; });
  _skuCapCache[vk] = ids;
  return ids;
}

// Outcome vocabulary. Order here is the order of the buttons.
var TARGET_STATUSES = [
  { key: "sold", label: "Sold in", cls: "ts-sold" },
  { key: "declined", label: "Declined", cls: "ts-declined" },
  { key: "notstocked", label: "Not stocked", cls: "ts-notstocked" },
  { key: "working", label: "Still working", cls: "ts-working" },
];

// Kept in sync with VALID_REASONS in netlify/functions/targets.mjs.
var DECLINE_REASONS = [
  { key: "space", label: "No shelf space" },
  { key: "price", label: "Price / margin" },
  { key: "slow", label: "Says it moves slow" },
  { key: "dc", label: "Not available at DC" },
  { key: "corporate", label: "Corporate decision" },
  { key: "buyer", label: "Buyer unavailable" },
  { key: "other", label: "Other" },
];

/* --- State ---------------------------------------------------------------- */

var TARGET_REP = null; // selected rep, or "all" for the manager rollup
var TARGET_PERIOD = currentPeriod();
var TARGET_RECORDS = {}; // key -> {status, reason, note, ts}
var TARGET_ROLLUP = null; // populated in manager view
var TARGET_LOADING = false;
var TARGET_ERROR = "";

function currentPeriod() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function periodLabel(p) {
  var parts = String(p).split("-");
  var months = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
  var mi = parseInt(parts[1], 10) - 1;
  return (months[mi] || "") + " " + parts[0];
}

// Safari clears storage on inactive sites, so treat a missing rep as
// first-run rather than an error state.
function loadSavedRep() {
  try {
    return window.localStorage.getItem("agbr-rep") || null;
  } catch (e) {
    return null;
  }
}

function saveRep(rep) {
  try {
    window.localStorage.setItem("agbr-rep", rep);
  } catch (e) {
    /* private browsing — the picker just reappears next visit */
  }
}

/* --- Target selection ----------------------------------------------------- */

/*
 * Chain inference. Store names in this data share a leading banner word
 * ("Cannata's Morgan City", "Cannata's West Houma"), so the first token is a
 * good-enough chain key for spreading a rep's month across banners.
 */
function chainKey(name) {
  return String(name).split(/[\s\-–]+/)[0].toLowerCase().replace(/[^a-z0-9']/g, "");
}

/*
 * Every store a rep owns, with its gaps across all vendors in VENDORS.
 * Returns rows shaped:
 *   {store, city, id, oppWeekly, gaps:[{vk, vendorName, sku, oppWeekly}]}
 */
function buildRepStoreGaps(rep) {
  var byStore = {};

  Object.keys(VENDORS).forEach(function (vk) {
    var m = VENDORS[vk];
    if (!m || !m.stores) return;

    m.stores.forEach(function (s) {
      if ((s.rep || "Not Assigned") !== rep) return;

      var calc = storeOppCalc(s, m);
      if (!calc.mCoreElig.length) return;

      if (!byStore[s.id]) {
        byStore[s.id] = {
          id: s.id,
          name: s.name,
          city: s.city,
          r4: s.r4 || 0,
          oppWeekly: 0,
          allGapCount: 0,
          gaps: [],
        };
      }

      var entry = byStore[s.id];
      // A store's revenue differs per vendor feed; keep the largest as the
      // headline figure rather than summing unrelated bases.
      if ((s.r4 || 0) > entry.r4) entry.r4 = s.r4 || 0;

      var allowed = cappedSkuIds(vk, m);

      calc.mCoreElig.forEach(function (sk) {
        var w = skuWeeklyOpp(sk, s, m);
        // The store's headline number counts every open core gap, capped or
        // not — a rep should see what the account is really worth.
        entry.oppWeekly += w;
        entry.allGapCount++;

        if (allowed && !allowed[sk.id]) return;

        entry.gaps.push({
          vk: vk,
          vendorName: (m.name || vk.toUpperCase()),
          skuId: sk.id,
          skuDesc: sk.desc,
          cat: sk.cat || "",
          oppWeekly: w,
          key: s.id + ":" + vk + ":" + sk.id,
        });
      });
    });
  });

  return Object.keys(byStore)
    .map(function (id) {
      var row = byStore[id];
      row.gaps.sort(function (a, b) { return b.oppWeekly - a.oppWeekly; });
      // oppWeekly stays the store's full opportunity — the headline number
      // should reflect everything open there, not just what's shown.
      row.totalGapCount = row.allGapCount;
      row.gaps = trimGaps(row.gaps);
      return row;
    })
    .sort(function (a, b) { return b.oppWeekly - a.oppWeekly; });
}

/*
 * Reduce a store's gaps to the set worth a rep's visit: the top gap from each
 * vendor present, then the highest remaining by dollar value until full.
 * Input must already be sorted by oppWeekly descending.
 */
function trimGaps(gaps) {
  if (gaps.length <= GAPS_PER_STORE) return gaps;

  var picked = [];
  var seenVendor = {};

  // Focus areas claim their slots before anything else, or the dollar sort
  // buries them. Only reserves a slot when the store actually has that gap.
  STORE_FOCUS_FLOOR.forEach(function (f) {
    var matches = gaps.filter(function (g) {
      return g.vk === f.vk && g.cat === f.cat;
    });
    matches.slice(0, f.slots).forEach(function (g) {
      if (picked.length < GAPS_PER_STORE && picked.indexOf(g) < 0) {
        picked.push(g);
        seenVendor[g.vk] = (seenVendor[g.vk] || 0) + 1;
      }
    });
  });

  gaps.forEach(function (g) {
    if (picked.length >= GAPS_PER_STORE) return;
    if (picked.indexOf(g) >= 0) return;
    var n = seenVendor[g.vk] || 0;
    if (n < MIN_PER_VENDOR) {
      seenVendor[g.vk] = n + 1;
      picked.push(g);
    }
  });

  for (var i = 0; i < gaps.length && picked.length < GAPS_PER_STORE; i++) {
    if (picked.indexOf(gaps[i]) < 0) picked.push(gaps[i]);
  }

  return picked.sort(function (a, b) { return b.oppWeekly - a.oppWeekly; });
}

/*
 * The month's assigned stores: highest opportunity first, but no more than
 * MAX_PER_CHAIN from any one banner. If the cap leaves the list short, the
 * skipped stores backfill in rank order.
 */
function selectTargets(rep) {
  var all = buildRepStoreGaps(rep);
  var chosen = [];
  var skipped = [];
  var chainCount = {};

  all.forEach(function (row) {
    if (chosen.length >= TARGETS_PER_REP) return;
    var ck = chainKey(row.name);
    var n = chainCount[ck] || 0;
    if (n >= MAX_PER_CHAIN) {
      skipped.push(row);
      return;
    }
    chainCount[ck] = n + 1;
    chosen.push(row);
  });

  // Backfill relaxes the cap one step at a time rather than abandoning it, so
  // a rep whose territory is three banners still gets a full list without one
  // banner swallowing it.
  var relaxed = MAX_PER_CHAIN;
  while (chosen.length < TARGETS_PER_REP && skipped.length) {
    relaxed++;
    var stillSkipped = [];
    skipped.forEach(function (row) {
      if (chosen.length >= TARGETS_PER_REP) {
        stillSkipped.push(row);
        return;
      }
      var ck = chainKey(row.name);
      var n = chainCount[ck] || 0;
      if (n >= relaxed) {
        stillSkipped.push(row);
        return;
      }
      chainCount[ck] = n + 1;
      chosen.push(row);
    });
    if (stillSkipped.length === skipped.length) break; // no progress
    skipped = stillSkipped;
  }

  return chosen;
}

/* True when a gap belongs to a category reserved by STORE_FOCUS_FLOOR. */
function isFocusGap(g) {
  return STORE_FOCUS_FLOOR.some(function (f) {
    return g.vk === f.vk && g.cat === f.cat;
  });
}

/* --- Persistence ---------------------------------------------------------- */

function targetsApi(path) {
  return "/api/targets" + path;
}

function loadTargetRecords(rep, cb) {
  TARGET_LOADING = true;
  TARGET_ERROR = "";
  var q = "?period=" + encodeURIComponent(TARGET_PERIOD) +
          "&rep=" + encodeURIComponent(rep);

  fetch(targetsApi(q), { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    })
    .then(function (data) {
      TARGET_LOADING = false;
      if (rep === "all") {
        TARGET_ROLLUP = data.reps || {};
      } else {
        TARGET_RECORDS = data.records || {};
      }
      cb && cb();
    })
    .catch(function () {
      TARGET_LOADING = false;
      TARGET_ERROR =
        "Can't reach the server. Your marks aren't saved — check your signal and tap again.";
      cb && cb();
    });
}

function saveTargetRecord(key, status, reason, note, cb) {
  var payload = {
    period: TARGET_PERIOD,
    rep: TARGET_REP,
    key: key,
    status: status,
    reason: reason || "",
    note: note || "",
  };

  // Optimistic: the button reflects the tap immediately, and rolls back only
  // if the write fails. Reps in a store shouldn't wait on a round trip.
  var previous = TARGET_RECORDS[key];
  TARGET_RECORDS[key] = {
    status: status,
    reason: reason || "",
    note: note || "",
    ts: new Date().toISOString(),
  };
  renderTargets();

  fetch(targetsApi(""), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (r) {
      if (!r.ok) throw new Error("status " + r.status);
      TARGET_ERROR = "";
      cb && cb();
    })
    .catch(function () {
      if (previous) TARGET_RECORDS[key] = previous;
      else delete TARGET_RECORDS[key];
      TARGET_ERROR = "That didn't save. Check your signal and tap again.";
      renderTargets();
    });
}

/* --- Interaction ---------------------------------------------------------- */

function chooseRep(rep) {
  TARGET_REP = rep;
  if (rep !== "all") saveRep(rep);
  renderTargets();
  loadTargetRecords(rep, renderTargets);
}

function switchRepView() {
  TARGET_REP = null;
  renderTargets();
}

function markTarget(key, status) {
  if (status === "declined") {
    openDeclineSheet(key);
    return;
  }
  saveTargetRecord(key, status, "", "");
}

function openDeclineSheet(key) {
  var sheet = document.getElementById("tg-decline-sheet");
  if (!sheet) return;
  sheet.dataset.key = key;
  sheet.classList.add("open");
}

function closeDeclineSheet() {
  var sheet = document.getElementById("tg-decline-sheet");
  if (sheet) sheet.classList.remove("open");
}

function pickDeclineReason(reason) {
  var sheet = document.getElementById("tg-decline-sheet");
  if (!sheet) return;
  var key = sheet.dataset.key;
  closeDeclineSheet();
  if (key) saveTargetRecord(key, "declined", reason, "");
}

function toggleTargetStore(id) {
  var row = document.getElementById("tg-store-" + id);
  if (!row) return;
  row.classList.toggle("tg-open");
}

function storeProgress(row) {
  var done = 0;
  row.gaps.forEach(function (g) {
    var rec = TARGET_RECORDS[g.key];
    if (rec && rec.status && rec.status !== "working") done++;
  });
  return { done: done, total: row.gaps.length };
}

/* --- Rendering ------------------------------------------------------------ */

function renderTargets() {
  var el = document.getElementById("panel-overview");
  if (!el) return;

  if (!TARGET_REP) {
    el.innerHTML = renderRepPicker();
    return;
  }
  if (TARGET_REP === "all") {
    el.innerHTML = renderManagerRollup();
    return;
  }
  el.innerHTML = renderRepTargets();
}

function renderRepPicker() {
  var html = '<div class="tg-picker">';
  html += '<div class="tg-picker-title">Who\'s working today?</div>';
  html += '<div class="tg-picker-sub">Pick your name once. This device will remember it.</div>';
  html += '<div class="tg-picker-grid">';
  TARGET_REPS.forEach(function (rep) {
    var cls = REP_COLORS[rep] || "rep-none";
    html += '<button class="tg-picker-btn ' + cls + '" onclick="chooseRep(\'' +
            rep.replace(/'/g, "\\'") + '\')">' +
            '<span class="rep-dot"></span>' + rep + "</button>";
  });
  html += "</div>";
  html += '<button class="tg-picker-mgr" onclick="chooseRep(\'all\')">' +
          "View all reps (manager)</button>";
  html += "</div>";
  return html;
}

function renderRepTargets() {
  var targets = selectTargets(TARGET_REP);
  var repClass = REP_COLORS[TARGET_REP] || "rep-none";

  var totalOpp = targets.reduce(function (a, r) { return a + r.oppWeekly; }, 0);
  var totalGaps = targets.reduce(function (a, r) { return a + r.gaps.length; }, 0);
  var closed = 0;
  targets.forEach(function (r) { closed += storeProgress(r).done; });

  var html = "";

  html += '<div class="tg-head">';
  html += '<div class="tg-head-left">';
  html += '<span class="rep-badge ' + repClass + '"><span class="rep-dot"></span>' +
          TARGET_REP + "</span>";
  html += '<span class="tg-period">' + periodLabel(TARGET_PERIOD) + " targets</span>";
  html += "</div>";
  html += '<button class="tg-switch" onclick="switchRepView()">Not you?</button>';
  html += "</div>";

  if (TARGET_ERROR) {
    html += '<div class="tg-error">' + TARGET_ERROR + "</div>";
  }

  html += '<div class="tg-summary">';
  html += '<div class="tg-kpi"><div class="tg-kpi-val">' + targets.length +
          '</div><div class="tg-kpi-label">stores this month</div></div>';
  html += '<div class="tg-kpi"><div class="tg-kpi-val">' + closed + "/" + totalGaps +
          '</div><div class="tg-kpi-label">gaps worked</div></div>';
  html += '<div class="tg-kpi"><div class="tg-kpi-val">' +
          fmt(Math.round(totalOpp * 52)) +
          '</div><div class="tg-kpi-label">annual opportunity on the list</div></div>';
  html += "</div>";

  if (TARGET_LOADING) {
    html += '<div class="tg-loading">Loading your marks…</div>';
  }

  if (!targets.length) {
    html += '<div class="tg-empty">No open core gaps in your stores this month. ' +
            "Nothing to work here — check the Store Lookup tab for new distribution.</div>";
    return html;
  }

  targets.forEach(function (row, i) {
    var prog = storeProgress(row);
    var complete = prog.done === prog.total;
    var dir = STORE_DIR[row.id];

    html += '<div class="tg-store' + (complete ? " tg-done" : "") +
            '" id="tg-store-' + row.id + '">';

    html += '<div class="tg-store-head" onclick="toggleTargetStore(\'' + row.id + '\')">';
    html += '<div class="tg-rank">#' + (i + 1) + "</div>";
    html += '<div class="tg-store-main">';
    html += '<div class="tg-store-name">' + row.name +
            ' <span class="tg-store-city">' + row.city + "</span></div>";
    html += '<div class="tg-store-meta">' + prog.done + " of " + prog.total +
            " gaps worked &middot; " + fmt(row.r4 / 4) + "/wk current</div>";
    html += "</div>";
    html += '<div class="tg-store-opp">+' + fmt(Math.round(row.oppWeekly)) +
            '<span class="tg-per">/wk</span></div>';
    html += '<span class="tg-chev">&#9658;</span>';
    html += "</div>";

    html += '<div class="tg-store-body">';

    if (dir) {
      html += '<div class="tg-dir">';
      html += '<a href="https://maps.google.com/?q=' +
              encodeURIComponent((dir.a || "") + ", " + row.city + " LA") +
              '" target="_blank">&#x1F4CD; ' + dir.a + "</a>";
      if (dir.p) {
        html += ' <a href="tel:' + dir.p.replace(/[^0-9]/g, "") + '">&#x1F4DE; ' +
                dir.p + "</a>";
      }
      html += "</div>";
    }

    row.gaps.forEach(function (g) {
      var rec = TARGET_RECORDS[g.key];
      var st = rec ? rec.status : "";
      html += '<div class="tg-gap' + (st && st !== "working" ? " tg-gap-done" : "") + '">';
      html += '<div class="tg-gap-top">';
      html += '<span class="tg-vend">' + g.vendorName + "</span>";
      if (isFocusGap(g)) html += '<span class="tg-focus">Focus</span>';
      html += '<span class="tg-gap-opp">+' + fmt(Math.round(g.oppWeekly * 52)) + "/yr</span>";
      html += "</div>";
      html += '<div class="tg-gap-desc">' + g.skuDesc + "</div>";

      if (st === "declined" && rec.reason) {
        var rl = DECLINE_REASONS.filter(function (r) { return r.key === rec.reason; })[0];
        html += '<div class="tg-gap-reason">Declined — ' +
                (rl ? rl.label : rec.reason) + "</div>";
      }

      html += '<div class="tg-btns">';
      TARGET_STATUSES.forEach(function (s) {
        var active = st === s.key ? " active" : "";
        html += '<button class="tg-btn ' + s.cls + active +
                '" onclick="markTarget(\'' + g.key + "','" + s.key + "')\">" +
                s.label + "</button>";
      });
      html += "</div>";
      html += "</div>";
    });

    var hidden = (row.totalGapCount || row.gaps.length) - row.gaps.length;
    if (hidden > 0) {
      html += '<div class="tg-more">' + hidden +
              " smaller gap" + (hidden !== 1 ? "s" : "") +
              " not shown &mdash; see Store Lookup for the full list</div>";
    }

    html += "</div>";
    html += "</div>";
  });

  html += renderDeclineSheet();
  return html;
}

function renderDeclineSheet() {
  var html = '<div class="tg-sheet" id="tg-decline-sheet">';
  html += '<div class="tg-sheet-inner">';
  html += '<div class="tg-sheet-title">Why did they pass?</div>';
  DECLINE_REASONS.forEach(function (r) {
    html += '<button class="tg-sheet-btn" onclick="pickDeclineReason(\'' +
            r.key + "')\">" + r.label + "</button>";
  });
  html += '<button class="tg-sheet-cancel" onclick="closeDeclineSheet()">Cancel</button>';
  html += "</div></div>";
  return html;
}

function renderManagerRollup() {
  var html = "";

  html += '<div class="tg-head">';
  html += '<div class="tg-head-left">';
  html += '<span class="rep-badge rep-none"><span class="rep-dot"></span>All reps</span>';
  html += '<span class="tg-period">' + periodLabel(TARGET_PERIOD) + " rollup</span>";
  html += "</div>";
  html += '<button class="tg-switch" onclick="switchRepView()">Change</button>';
  html += "</div>";

  if (TARGET_LOADING || !TARGET_ROLLUP) {
    html += '<div class="tg-loading">Loading outcomes…</div>';
    return html;
  }

  var reasonTally = {};
  var netSold = 0, netDeclined = 0, netNotStocked = 0, netWorking = 0, netTotal = 0;

  var repRows = TARGET_REPS.map(function (rep) {
    var targets = selectTargets(rep);
    var recs = TARGET_ROLLUP[rep] || {};
    var counts = { sold: 0, declined: 0, notstocked: 0, working: 0 };
    var total = 0;

    targets.forEach(function (row) {
      row.gaps.forEach(function (g) {
        total++;
        var rec = recs[g.key];
        if (!rec || !rec.status) return;
        counts[rec.status] = (counts[rec.status] || 0) + 1;
        if (rec.status === "declined" && rec.reason) {
          reasonTally[rec.reason] = (reasonTally[rec.reason] || 0) + 1;
        }
      });
    });

    netSold += counts.sold;
    netDeclined += counts.declined;
    netNotStocked += counts.notstocked;
    netWorking += counts.working;
    netTotal += total;

    return {
      rep: rep,
      counts: counts,
      total: total,
      stores: targets.length,
      touched: counts.sold + counts.declined + counts.notstocked + counts.working,
    };
  }).sort(function (a, b) { return b.counts.sold - a.counts.sold; });

  html += '<div class="tg-summary">';
  html += '<div class="tg-kpi"><div class="tg-kpi-val">' + netSold +
          '</div><div class="tg-kpi-label">sold in</div></div>';
  html += '<div class="tg-kpi"><div class="tg-kpi-val">' + netDeclined +
          '</div><div class="tg-kpi-label">declined</div></div>';
  html += '<div class="tg-kpi"><div class="tg-kpi-val">' +
          (netTotal - netSold - netDeclined - netNotStocked - netWorking) +
          '</div><div class="tg-kpi-label">untouched</div></div>';
  html += "</div>";

  html += '<div class="list-section"><div class="list-header">By rep</div>';
  repRows.forEach(function (r) {
    var cls = REP_COLORS[r.rep] || "rep-none";
    html += '<div class="list-row">';
    html += '<div style="flex:1;"><span class="rep-badge ' + cls +
            '"><span class="rep-dot"></span>' + r.rep + "</span>";
    html += '<div style="font-size:10px;color:#8ba3cc;margin-top:4px;">' +
            r.stores + " stores &middot; " + r.touched + " of " + r.total +
            " gaps marked</div></div>";
    html += '<div style="text-align:right;font-size:11px;">';
    html += '<span style="color:#1a7a1a;font-weight:700;">' + r.counts.sold + " sold</span>";
    html += '<div style="color:#8ba3cc;">' + r.counts.declined + " declined &middot; " +
            r.counts.working + " working</div>";
    html += "</div></div>";
  });
  html += "</div>";

  var reasons = Object.keys(reasonTally).sort(function (a, b) {
    return reasonTally[b] - reasonTally[a];
  });

  if (reasons.length) {
    html += '<div class="list-section"><div class="list-header">' +
            "Why they passed &mdash; across all reps</div>";
    reasons.forEach(function (k) {
      var rl = DECLINE_REASONS.filter(function (r) { return r.key === k; })[0];
      html += '<div class="list-row"><div style="flex:1;">' +
              (rl ? rl.label : k) + "</div>";
      html += '<div class="list-val">' + reasonTally[k] + "</div></div>";
    });
    html += "</div>";
  }

  return html;
}

/* --- Entry point ---------------------------------------------------------- */

// Called by the tab button in place of renderRepOpps().
function renderRepOpps() {
  if (!TARGET_REP) {
    var saved = loadSavedRep();
    if (saved && TARGET_REPS.indexOf(saved) >= 0) {
      chooseRep(saved);
      return;
    }
  }
  renderTargets();
  if (TARGET_REP && !TARGET_LOADING) {
    loadTargetRecords(TARGET_REP, renderTargets);
  }
}

// Legacy shim retained: other code paths call renderOverview().
function renderOverview() { renderRepOpps(); }
