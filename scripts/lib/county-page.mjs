// Per-county page text built only from the county's own data, so each county page says
// something no other page says. Used by src/_data/counties.js. Nothing here invents facts:
// every sentence restates a field that came from the county's pages.
import { today } from "./data.mjs";

const SALE_TYPE_TEXT = {
  lien: "sells tax lien certificates on unpaid property taxes",
  deed: "sells tax-delinquent property at tax deed sales",
  "redeemable deed": "sells tax-delinquent property at redeemable deed sales, where the former owner can still buy it back for a set time after the sale",
  hybrid: "holds tax sales that mix lien and deed features",
};

const longDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// Ends a sentence that may already end in punctuation.
const sentence = (s) => {
  const t = String(s || "").trim();
  if (!t) return "";
  return /[.!?)"”]$/.test(t) ? t : `${t}.`;
};

function formatText(c) {
  const p = c.platform && c.platform.name ? c.platform.name : null;
  switch (c.format) {
    case "online":
      return p ? `Bidding is online, on ${p}.` : "Bidding is online.";
    case "in person":
      return "Bidding is in person.";
    case "both":
      return p ? `The county takes bids both online (on ${p}) and in person.` : "The county takes bids both online and in person.";
    default:
      return p
        ? `The county uses ${p}, but its pages don't say whether bidding is online or in person.`
        : "The county's pages don't say whether bidding is online or in person.";
  }
}

function cut(text, max) {
  if (text.length <= max) return text;
  const s = text.slice(0, max - 1);
  return `${s.slice(0, Math.max(s.lastIndexOf(" "), max - 20)).replace(/[,;:\s]+$/, "")}…`;
}

export function countyPageFields(c, state) {
  const now = today();
  const pastSales = (c.sales || [])
    .filter((s) => (s.end_date || s.date) < now)
    .sort((a, b) => b.date.localeCompare(a.date));
  const next = c.link_only ? null : c.upcoming[0];

  // Opening paragraph.
  const parts = [`${c.fullName}, ${state.name}, ${SALE_TYPE_TEXT[c.sale_type] || `holds ${c.sale_type} tax sales`}.`];
  if (!c.link_only) {
    parts.push(formatText(c));
    if (next) {
      parts.push(`The next sale we've confirmed on the county's own pages is ${longDate(next.date)}${next.label ? ` (${next.label.replace(/\.$/, "")})` : ""}.`);
      if (c.upcoming.length > 1) parts.push(`${c.upcoming.length - 1} more ${c.upcoming.length === 2 ? "date is" : "dates are"} posted after that.`);
    } else if (c.schedule_rule) {
      parts.push("It hasn't posted a specific next date, but it states a recurring schedule, quoted below.");
    }
    if (pastSales.length) parts.push(`The most recent sale on record was ${longDate(pastSales[0].date)}.`);
  }
  const srcCount = (c.sources || []).length;
  if (srcCount && c.lastChecked)
    parts.push(`We read ${srcCount === 1 ? "one county page" : `${srcCount} county pages`} for this, most recently on ${longDate(c.lastChecked)}.`);
  const intro = parts.join(" ");

  // Quotes from the county's pages (already stored as evidence), skipping repeats of the schedule rule.
  const quotes = c.link_only
    ? []
    : (c.evidence || [])
        .filter((e) => e && e.quote && e.url && e.quote.trim() !== (c.schedule_rule || "").trim())
        .filter((e, i, arr) => arr.findIndex((x) => x.quote === e.quote) === i)
        .map((e) => ({ quote: e.quote.trim(), url: e.url, host: host(e.url) }));

  // Short notes the research left that a bidder can use.
  const n = c.notes && typeof c.notes === "object" ? c.notes : {};
  const extraNotes = ["format_note", "registration_note", "deposit_note", "platform_note", "location_note", "date_note", "time_note", "scope"]
    .map((k) => n[k])
    .filter((v) => typeof v === "string" && v.trim() && !/https?:\/\//.test(v))
    .map(sentence);

  // Meta description: unique per county, at most 155 characters.
  const kind = { lien: "tax lien", deed: "tax deed", "redeemable deed": "redeemable tax deed" }[c.sale_type] || "tax";
  const tail = c.link_only ? "" : c.format === "online" ? " Online: how to register and pay." : c.format === "in person" ? " In person: how to register and pay." : " How to register, bid and pay.";
  const room = 155 - tail.length;
  let lead;
  if (c.link_only) lead = `${c.fullName}, ${state.state} tax sale: where the county posts its dates and terms.`;
  else if (next) lead = `${c.fullName}, ${state.state} ${kind} sale on ${shortDate(next.date)}.`;
  else if (c.schedule_rule) {
    const head = `${c.fullName}, ${state.state} ${kind} sales: `;
    lead = `${head}${cut(c.schedule_rule.replace(/\s+/g, " ").replace(/\.$/, ""), room - head.length - 1).replace(/…$/, "")}${c.schedule_rule.length > room - head.length - 1 ? "…" : "."}`;
  } else lead = `${c.fullName}, ${state.state} ${kind} sale: when the next one is and how to bid.`;
  const description = cut(lead, room) + tail;

  // First sentence of the state's overview, for "How {state} tax sales work".
  const stateFirst = (state.overview || "").match(/^.*?[.!?](\s|$)/)?.[0]?.trim() || state.overview || "";

  // Pages Google should index: ones that give a dated sale, a stated recurring schedule, or a past sale on
  // record. The rest say little beyond "no date posted yet", so they stay up for visitors but carry noindex
  // and leave the sitemap until the county posts something. Rebuilt on every deploy, so a county that posts
  // a date becomes indexable again by itself.
  const indexable = !c.link_only && Boolean(c.upcoming.length || c.schedule_rule || pastSales.length);

  return { pastSales, intro, quotes, extraNotes, description, stateFirst, indexable };
}
