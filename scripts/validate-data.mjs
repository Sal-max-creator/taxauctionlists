// Checks every state file before a build. Fails on anything that would put an unsourced
// or link-only-sourced sale on the site.
import { readStateFiles } from "./lib/data.mjs";
import { isLinkOnly } from "./lib/rules.mjs";

const SALE_TYPES = new Set(["lien", "deed", "hybrid", "redeemable deed"]);
const FORMATS = new Set(["online", "in person", "both", "unknown"]);
const errors = [];
const warnings = [];

for (const { file, data } of readStateFiles()) {
  const where = (msg) => `${file.split("/").pop()}: ${msg}`;
  if (!/^[A-Z]{2}$/.test(data.state || "")) errors.push(where("state must be a 2-letter code"));
  if (!data.name) errors.push(where("missing name"));
  if (!SALE_TYPES.has(data.sale_type)) errors.push(where(`unknown state sale_type "${data.sale_type}"`));
  if (!data.overview) errors.push(where("missing overview"));
  for (const s of data.overview_sources || []) if (isLinkOnly(s.url)) errors.push(where(`overview source is link-only: ${s.url}`));

  const slugs = new Set();
  for (const c of data.counties || []) {
    const cw = (msg) => where(`${c.county}: ${msg}`);
    if (!c.slug || !/^[a-z0-9-]+$/.test(c.slug)) errors.push(cw(`bad slug "${c.slug}"`));
    if (slugs.has(c.slug)) errors.push(cw(`duplicate slug "${c.slug}"`));
    slugs.add(c.slug);
    if (!c.office) errors.push(cw("missing office"));
    if (!SALE_TYPES.has(c.sale_type)) errors.push(cw(`unknown sale_type "${c.sale_type}"`));
    if (!FORMATS.has(c.format)) errors.push(cw(`unknown format "${c.format}"`));
    if (!(c.sources || []).length) errors.push(cw("no sources"));
    for (const s of c.sources || []) {
      if (!s.url) errors.push(cw("source without url"));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.read_on || "")) errors.push(cw(`source ${s.url} has no read_on date`));
      if (isLinkOnly(s.url)) errors.push(cw(`source is link-only, use platform.url instead: ${s.url}`));
      if (!s.terms) warnings.push(cw(`no terms note for ${s.url}`));
    }
    const sourceUrls = new Set((c.sources || []).map((s) => s.url));
    for (const sale of c.sales || []) {
      const sw = (msg) => cw(`sale ${sale.date}: ${msg}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sale.date || "") || Number.isNaN(Date.parse(sale.date))) errors.push(sw("bad date"));
      if (sale.end_date && (!/^\d{4}-\d{2}-\d{2}$/.test(sale.end_date) || sale.end_date < sale.date)) errors.push(sw("bad end_date"));
      if (!sale.source_url) errors.push(sw("no source_url"));
      else if (isLinkOnly(sale.source_url)) errors.push(sw(`source is link-only: ${sale.source_url}`));
      else if (!sourceUrls.has(sale.source_url)) errors.push(sw(`source_url not listed in county sources: ${sale.source_url}`));
      if (!sale.quote) errors.push(sw("no quote from the source"));
      if (sale.register_by && (!/^\d{4}-\d{2}-\d{2}$/.test(sale.register_by) || sale.register_by > (sale.end_date || sale.date))) errors.push(sw("bad register_by (YYYY-MM-DD, on or before the sale ends)"));
      if (sale.register_by && !sale.registration_deadline) errors.push(sw("register_by needs the registration_deadline text it comes from"));
      if (sale.list_url && isLinkOnly(sale.list_url)) errors.push(sw(`list_url is link-only: ${sale.list_url}`));
      if (!sale.label) warnings.push(sw("no label"));
    }
    if (c.recurs && !["weekly", "monthly"].includes(c.recurs)) errors.push(cw(`recurs must be "weekly" or "monthly", not "${c.recurs}"`));
    if (c.recurs && !c.schedule_rule) errors.push(cw("recurs needs a schedule_rule"));
    if (c.link_only) {
      if (!c.link_only.reason) errors.push(cw("link_only needs a reason"));
      if ((c.sales || []).length || c.schedule_rule || c.how_to_bid) errors.push(cw("link_only county must not copy sales, schedule or how-to-bid text"));
    }
    if (!c.link_only && !(c.sales || []).length && !c.schedule_rule && !c.next_sale_note) warnings.push(cw("no sales, schedule or next-sale note"));
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Data OK (${warnings.length} warning(s)).`);
