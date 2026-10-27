# TaxAuctionLists.com

A free calendar of county tax lien and tax deed sales. Every sale date links to the county page it came from and shows when it was last checked. Private build: the site sets `noindex` and `robots.txt` blocks all crawlers until `public` is turned on in `src/_data/site.json`.

## Run it

```sh
npm ci
npm start            # dev server at http://localhost:8080
npm run build        # static site in _site/
npm run validate     # checks data/states/*.json
npm run terms-log    # regenerates SOURCES.md
```

Built with [Eleventy](https://www.11ty.dev/). Output is plain static HTML. Cloudflare deploys it as a Worker with static assets: `wrangler.jsonc` runs `npm run build` and serves `_site`, so Workers Builds needs no extra settings (deploy command `npx wrangler deploy`, non-production branches `npx wrangler versions upload`). Node 22 is pinned in `.nvmrc`. `src/headers.njk` writes Cloudflare's `_headers` file, which adds `X-Robots-Tag: noindex` while the site is private.

## Where things live

| Path | What |
|---|---|
| `data/states/XX.json` | One file per state: overview, counties, sales, sources and their terms |
| `src/` | Templates, guides (`src/guides/*.md`), CSS and JS |
| `src/_data/site.json` | Site name, `public` switch, signup endpoint (empty until an email tool is chosen) |
| `src/_data/linkOnly.json` | Sources we link to but never copy from |
| `scripts/validate-data.mjs` | Refuses sales without a source URL and quote, or sourced from a link-only site |
| `scripts/check-sources.mjs` | Weekly page checker used by the workflow |
| `SOURCES.md` | Generated source and terms log |

## Data rules

1. A sale date goes in only if it was read on an official county or state page, or a legally required notice. Store the page URL, a short verbatim `quote` containing the date, and `read_on`.
2. Never infer dates. If the county states a recurring rule ("every first Tuesday"), store it as `schedule_rule`, word for word.
3. Private auction platforms (RealAuction, Bid4Assets, GovEase, SRI and others) and sources whose terms forbid reuse (Maryland SDAT, Leon County FL's tax deed portal) are link-only. They can appear as `platform.url`, never as a source or a copied list. `scripts/lib/rules.mjs` enforces this.
4. Before adding a county, read its site's disclaimer or terms and record what it says in `sources[].terms`.

### State file shape

```jsonc
{
  "state": "FL", "name": "Florida", "sale_type": "lien",   // lien | deed | hybrid | redeemable deed
  "overview": "Plain-English summary", "overview_sources": [{ "url": "...", "quote": "..." }],
  "counties": [{
    "county": "Orange", "slug": "orange", "office": "...", "phone": "...", "address": "...", "website": "...",
    "sale_type": "deed", "format": "online",                 // online | in person | both | unknown
    "platform": { "name": "RealAuction", "url": "..." },     // link only
    "schedule_rule": "verbatim recurring rule or null",
    "sales": [{ "date": "2026-11-05", "time": "10:00 AM", "label": "...", "deposit": "...",
                "registration_deadline": "...", "source_url": "...", "quote": "..." }],
    "next_sale_note": "e.g. 2027 date not yet posted",
    "how_to_bid": "...",
    "sources": [{ "url": "...", "read_on": "2026-10-27", "terms": "...", "terms_url": "..." }]
  }]
}
```

## Weekly source check

`.github/workflows/source-check.yml` runs every Monday (and on demand from the Actions tab). It fetches each source page politely (robots.txt respected, 2 seconds between hits to a host), compares it with last week's snapshot on the `source-snapshots` branch, and opens an issue when a page changed, a sale is within 7 days, a page couldn't be checked, or a source hasn't been re-read in 30 days. It never edits sale data; a person reviews the issue and updates `data/states/` in a pull request. The first run only records a baseline.

## Not connected yet

No hosting, DNS, email tool, payments, analytics or ads are connected. The signup form shows a "signups open soon" message and sends nothing until `signupEndpoint` is set.
