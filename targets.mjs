import { getStore } from "@netlify/blobs";

/**
 * Target status persistence for the AGBR Opportunity Tool.
 *
 * Storage model
 * -------------
 * One blob per rep per period, keyed "<period>/<repSlug>".
 * The blob is a JSON object mapping a target key to an outcome record:
 *
 *   {
 *     "506:kh:972630": {
 *        status: "sold" | "declined" | "notstocked" | "working",
 *        reason: "<declined reason code, required when status==='declined'>",
 *        note:   "<optional free text>",
 *        ts:     "<ISO timestamp of last write>"
 *     },
 *     ...
 *   }
 *
 * Writes are per-item (PUT one key) so a rep tapping a button in a store with
 * bad signal never has to send the whole list. Last write wins on a key.
 *
 * Endpoints
 * ---------
 *   GET  /api/targets?period=2026-08&rep=Mike%20Barndt   -> that rep's records
 *   GET  /api/targets?period=2026-08&rep=all             -> every rep, for rollup
 *   PUT  /api/targets   body: {period, rep, key, status, reason, note}
 */

const VALID_STATUS = ["sold", "declined", "notstocked", "working"];

// Kept in sync with the DECLINE_REASONS list in index.html.
const VALID_REASONS = [
  "space",
  "price",
  "slow",
  "dc",
  "corporate",
  "buyer",
  "other",
];

const REPS = [
  "Carla Hicks",
  "Diane Bruce",
  "Donna Willie",
  "Mike Barndt",
  "Natasha Palmer",
  "Ryan Stribling",
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Rep devices should never serve a cached target list.
      "cache-control": "no-store",
    },
  });

// A period is a calendar month: YYYY-MM.
const validPeriod = (p) => /^\d{4}-\d{2}$/.test(p || "");

export default async (req) => {
  const store = getStore("agbr-targets");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const period = url.searchParams.get("period");
    const rep = url.searchParams.get("rep");

    if (!validPeriod(period)) {
      return json({ error: "Provide a period as YYYY-MM." }, 400);
    }

    // Rollup: pull every rep's blob for the period.
    if (rep === "all") {
      const out = {};
      await Promise.all(
        REPS.map(async (r) => {
          const rec = await store.get(`${period}/${slug(r)}`, { type: "json" });
          out[r] = rec || {};
        })
      );
      return json({ period, reps: out });
    }

    if (!REPS.includes(rep)) {
      return json({ error: "Unknown rep." }, 400);
    }

    const rec = await store.get(`${period}/${slug(rep)}`, { type: "json" });
    return json({ period, rep, records: rec || {} });
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400);
    }

    const { period, rep, key, status, reason, note } = body || {};

    if (!validPeriod(period)) {
      return json({ error: "Provide a period as YYYY-MM." }, 400);
    }
    if (!REPS.includes(rep)) {
      return json({ error: "Unknown rep." }, 400);
    }
    if (!key || typeof key !== "string") {
      return json({ error: "Provide a target key." }, 400);
    }
    if (!VALID_STATUS.includes(status)) {
      return json({ error: "Unknown status." }, 400);
    }
    // Declined outcomes carry a reason — that field is the point of the log.
    if (status === "declined" && !VALID_REASONS.includes(reason)) {
      return json({ error: "Declined needs a reason." }, 400);
    }

    const blobKey = `${period}/${slug(rep)}`;
    const current = (await store.get(blobKey, { type: "json" })) || {};

    current[key] = {
      status,
      reason: status === "declined" ? reason : "",
      note: typeof note === "string" ? note.slice(0, 280) : "",
      ts: new Date().toISOString(),
    };

    await store.setJSON(blobKey, current);
    return json({ ok: true, key, record: current[key] });
  }

  return json({ error: "Method not allowed." }, 405);
};

export const config = { path: "/api/targets" };
