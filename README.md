# TaxAuctionLists.com

A free calendar of county tax lien and tax deed sales. Every sale date links to the county page it came from and shows when it was last checked. Private build: the site sets `noindex` and `robots.txt` blocks all crawlers until `public` is turned on in `src/_data/site.json`.

## Run it

```sh
npm ci
npm start            # dev server at http://localhost:8080
npm run build        # static site in _site/
npm run validate     # checks data/states/*.json
npm run terms-log    # regenerates SOURCES.md
npm run alert-draft  # prints this week's paid Alerts email draft (Markdown)
```

Built with [Eleventy](https://www.11ty.dev/). Output is plain static HTML. Cloudflare deploys it as a Worker with static assets: `wrangler.jsonc` runs `npm run build` and serves `_site`, and `worker/index.js` runs only for `/api/*` (the signup form), so Workers Builds needs no extra settings (deploy command `npx wrangler deploy`, non-production branches `npx wrangler versions upload`). Node 22 is pinned in `.nvmrc`. `src/headers.njk` writes Cloudflare's `_headers` file, which adds `X-Robots-Tag: noindex` while the site is private.

## Where things live

| Path | What |
|---|---|
| `data/states/XX.json` | One file per state: overview, counties, sales, sources and their terms |
| `src/` | Templates, guides (`src/guides/*.md`), CSS and JS |
| `src/_data/site.json` | Site name, `public` switch, signup endpoint (`/api/subscribe`; empty sends nothing), paid Alerts settings (`paid`) |
| `src/alerts.njk` | The paid Alerts page (`/alerts/`) |
| `scripts/alert-draft.mjs` | Writes the weekly Alerts email draft as Markdown (sends nothing) |
| `worker/index.js` | Signup handler: checks the form and adds the address to Buttondown |
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

## Email signup

The form posts to `/api/subscribe` on the site itself. The Worker checks the address, ignores bots that fill the hidden `company` field, refuses posts from other sites, allows 5 tries per visitor per minute, and then creates the subscriber in Buttondown with the optional states in `metadata.states`. Buttondown sends its own confirmation email (double opt-in). Someone already on the list sees the same message as a new signup.

The Buttondown API key is a Worker secret, not a repo file or a GitHub Actions secret (Actions secrets never reach the Worker): Cloudflare dashboard > Workers & Pages > `taxauctionlists` > Settings > Variables and Secrets > Add, type **Secret**, name `BUTTONDOWN_API_KEY`. Deploys keep it. Without it the form says signups aren't open yet and sends nothing. `npm run test:worker` tests the handler with Buttondown faked.

## Paid Alerts ($19/month)

`/alerts/` explains the paid tier and links to Buttondown's own checkout at `https://buttondown.com/taxauctionlists/buy`. Payments run through the Stripe account connected to Buttondown; this site has no payment code and never sees a card. Subscribers cancel, change their card or see past payments through Buttondown's subscriber portal (link in every email footer, or `https://buttondown.com/login?subscriber=1`).

The button stays a disabled "Alerts open soon" until `paid.open` in `src/_data/site.json` is `true`. Turn it on only after the plan exists in Buttondown (Settings > Paid subscriptions):

| Setting | Value |
|---|---|
| Content access | Free and paid subscriptions |
| Currency | USD |
| Payment model | Fixed |
| Cadence | Monthly |
| Price | 19 |
| Yearly upsell price | blank (no yearly option for now) |

Buttondown needs its paid subscriptions add-on for this and has no Stripe test mode; its docs say to test with a small real charge and refund it.

### Sending the weekly email

1. After the Monday source check issue is reviewed and `data/states/` is updated, run `npm run alert-draft` (options: `--days 45`, `--since <git ref>`; by default it compares with the commit from 7 days ago).
2. Read it, fix anything the script can't know (cancellations announced elsewhere, notes), and attach parcel lists by hand: a spreadsheet only where the county's terms allow reuse, a link to the county's own list otherwise, nothing copied from link-only sources.
3. Paste it into a new Buttondown email and, under Send > Audience, pick **Premium** so only paying subscribers get it.

The script only prints text. It never calls Buttondown.

## Not connected yet

No DNS, analytics or ads are connected. Paid Alerts checkout is open on the private site (`paid.open` is `true`); the plan was saved in Buttondown on Oct 27, 2026.
