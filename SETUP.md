# AGBR Opportunity Tool — Monthly Targets

Replaces the Rep Opportunities tab with a store-anchored monthly target list
that reps mark outcomes on, plus a manager rollup.

## What's here

| File | What it is |
|---|---|
| `index.html` | The tool, targets panel already merged. |
| `netlify/functions/targets.mjs` | Backend. Reads and writes outcome marks. |
| `netlify.toml` | Site config. Routes `/api/targets`, stops the HTML caching. |
| `package.json` | Declares the Netlify Blobs dependency. |
| `manifest.json` | Home screen install. |
| `sw.js` | Offline support. |

`index.html` is here and ready — the panel is already merged in.

## Step 1 — Repo and Netlify link

The current site is a manual deploy, which is why the Activity Log never
worked: manual sites can't run Functions, so there was nowhere to save. This
step is the one that unblocks everything else.

1. Create a GitHub repo and upload every file from this folder, keeping the
   folder structure (`netlify/functions/targets.mjs` must stay in its
   subfolder).
2. In Netlify, open the existing site → **Site configuration → Build & deploy
   → Link repository**. Point it at the new repo.
3. Leave the build command empty. Publish directory `.`.

Same site, same URL. Deploys now happen on push, and version history lives in
commits instead of `v4` filenames.

## Step 2 — Already done

`index.html` in this repo is your tool with the targets panel merged in: styles
in the `<style>` block, the panel replacing `renderRepOpps()`, and the PWA tags
in the head. Nothing to paste.

## Step 3 — Icons

Drop three PNGs into `/icons/`, exported from the MSS mark:

- `icon-192.png` — 192x192
- `icon-512.png` — 512x512
- `icon-512-maskable.png` — 512x512, logo at ~80% with padding so iOS and
  Android can crop without clipping

The tool works without them; the home screen icon just falls back to a
screenshot.

## Step 4 — Check it works

After the first deploy:

1. Open the site, go to the targets tab. You should get the rep picker.
2. Pick a rep. You should get their stores, ranked.
3. Open a store, mark a gap **Sold in**. Reload. The mark should still be there.

If the mark disappears on reload, the Function isn't reachable — check
**Functions** in the Netlify dashboard for `targets`. If it's absent, the repo
link didn't take.

## How targets are chosen

Each rep gets their 12 highest-opportunity stores, capped at 4 per banner so
a month isn't twelve Cannata's. Both numbers are constants at the top of
`targets-panel.js`:

```js
var TARGETS_PER_REP = 12;
var MAX_PER_CHAIN = 4;
```

Each store shows its 8 highest-value gaps, guaranteeing at least one from
every vendor present so a broad line doesn't crowd out the rest:

```js
var GAPS_PER_STORE = 8;
var MIN_PER_VENDOR = 1;
```

Broad lines are also capped before ranking. Rich's carries 78 core SKUs, which
crowds every other vendor out of the pool:

```js
var VENDOR_SKU_CAP = { rc: 25 };
```

The capped set is the top sellers by network 4-week revenue, seeded with one
SKU from each category first — so Rich's targets span 7 of its 8 categories
instead of collapsing into Cakes and Cookies. It covers 83% of Rich's network
volume either way.

This cap applies to targets only. Store Lookup, SKU Performance and the
dashboard still show all 114 Rich's SKUs, and each store row still reports its
full opportunity and true gap count — a rep sees "8 shown of 105" and can work
past the list.

To cap another line, add its vendor key: `{ rc: 25, cf: 20 }`.

### Focus categories

Within a capped line, a category can be guaranteed slots regardless of its
velocity:

```js
var VENDOR_CAT_FLOOR = {
  rc: { "Parfaits &amp; Cups": 6 },
};
```

Parfaits are a current focus area, so they hold 6 of Rich's 25 slots. That
displaced four cookie doughs and a BetterCreme running $5,300-7,700 in network
4-week revenue, and moved Rich's coverage from 83% to 78% of network volume —
a deliberate trade, not an accident.

Category keys must match the vendor's own strings exactly, including HTML
entities: the Rich's category is `Parfaits &amp; Cups`, not `Parfaits & Cups`.

Rich's cap sits at 31 rather than 25 so the six Parfaits are additive — the
focus area is carried without pushing out the cookie doughs and BetterCreme
the dollar ranking earns on its own. Coverage is 85% of network volume.

### Store-level focus

The pool floor gets a category into the running. This is what puts it in front
of a rep:

```js
var STORE_FOCUS_FLOOR = [
  { vk: "rc", cat: "Parfaits &amp; Cups", slots: 1 },
];
```

Each store reserves one of its eight visible slots for a Parfait gap, claimed
before the dollar sort runs. Without this, Parfaits rank around 14th of 16
Rich's gaps at a typical store and never surface — a $2,000/yr Parfait can't
outrank a $39,000/yr cake gap on its own.

Reserved rows carry a **Focus** badge, so a rep seeing a small number next to
large ones knows why it's on the list.

Currently a Parfait appears in 58 of 63 target stores. The other five have no
open Parfait gap — the floor only reserves a slot when there's something to
put in it.

Ranking by cases instead of dollars was considered and doesn't help: Rich's
high-dollar items also move high case counts (BetterCreme at 5.67 cases/wk,
French Bread Dough at 11.71, against Parfaits at ~1.5). Parfaits move from
14th to 9th of 16 — still outside the visible eight. The reserved slot is what
works.

Selection runs in the browser off `VENDORS`, so a store's gaps span every
vendor line at once — which is the point of anchoring on stores. Adding
vendors 7–12 to `VENDORS` puts them in targets automatically. No change here.

Targets recompute from current data on every load. If a store closes a gap and
you redeploy with new numbers, that gap leaves the list, and its mark stays in
storage but stops being counted. That's the intended behaviour for a monthly
cycle.

## The period

Targets are keyed to the calendar month, from `currentPeriod()`. On the 1st,
every rep gets a fresh list and last month's marks stay queryable at their
old period key.

Nothing rolls anything over. If a rep left six gaps as **Still working**, those
stores reappear next month only if they're still in the top 12 — which they
will be, since the opportunity hasn't moved.

## What isn't built

- **Automated target generation.** Selection is deterministic from the data,
  but nobody approves a list before reps see it. Month one, look at what each
  rep gets before you point them at it.
- **Notifications.** No day-15 nudge. Open the manager view and see who hasn't
  marked anything.
- **Auth.** The rep picker is a name tap, not a login. Anyone with the URL can
  view or mark anything. Fine for six reps on company iPhones; revisit if the
  team grows or the URL spreads.
- **Offline writes.** Reading works offline. Marking does not — a rep with no
  signal gets a visible error and taps again later. Queuing offline writes is
  possible but adds sync conflicts, and it's worth seeing whether it's a real
  problem before solving it.

## Rollout

The install prompt doesn't appear on iOS. Reps have to tap Share → Add to Home
Screen. Do it with them once — six people, five minutes each — rather than
sending instructions.

Month one will be rough. Some gaps will already be closed, and reps will push
back on the list. That's useful: the corrections are what make month two's
list credible.
