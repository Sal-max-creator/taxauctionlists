// Finds sale-looking dates in the text of a county's own pages and compares them with what the
// data says. Used by the weekly source check to flag counties whose pages show a new or changed
// date. It only flags: a person (or a reviewed pull request) changes the data.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// "December 9, 2026", "Dec. 9th 2026", "9 December 2026"
// (County pages also write "December 17 ,2026" and "February 16 th , 2027".)
const NAMED = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})\\b`, "gi");
// "March 17-18, 2027"
const NAMED_RANGE = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*[-\u2013]\\s*(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})\\b`, "gi");
const NAMED_DMY = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s+(20\\d{2})\\b`, "gi");
// "12/09/2026", "12-9-26"
const NUMERIC = /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|\d{2})\b/g;
// "2026-12-09"
const ISO = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;

// Words that put a date near a tax sale rather than, say, a page footer or a council meeting.
const SALE_WORDS = /tax sale|tax lien|lien sale|deed sale|tax deed|sheriff'?s? sale|auction|sale date|sale will|sale is|sale of|certificate|struck|bidder|bidding|regist|deposit|delinquent|tax foreclosure|commissioner'?s? sale|trustee'?s? sale|resale|land sale|surplus/i;
// Lines that are almost never a sale date even when they say "tax".
const NOISE = /redemption period|balance due|shall expire|copyright|©|last updated|updated on|posted on|page updated|revised|all rights reserved|due date|taxes are due|due by|installment|penalty|interest begins|bill(s)? (are|were) mailed|office (will be )?closed|holiday|meeting|agenda|minutes|budget/i;

function pad(n) {
  return String(n).padStart(2, "0");
}

function iso(y, m, d) {
  const year = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const t = new Date(`${date}T00:00:00Z`);
  return t.getUTCMonth() + 1 === month ? date : null; // rejects Feb 30 and the like
}

function monthIndex(name) {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

// Every date written in one line of text.
export function datesInLine(line) {
  const found = new Set();
  for (const m of line.matchAll(NAMED)) {
    const d = iso(m[3], monthIndex(m[1]), m[2]);
    if (d) found.add(d);
  }
  for (const m of line.matchAll(NAMED_RANGE)) {
    for (const day of [m[2], m[3]]) {
      const d = iso(m[4], monthIndex(m[1]), day);
      if (d) found.add(d);
    }
  }
  for (const m of line.matchAll(NAMED_DMY)) {
    const d = iso(m[3], monthIndex(m[2]), m[1]);
    if (d) found.add(d);
  }
  for (const m of line.matchAll(NUMERIC)) {
    const d = iso(m[3], m[1], m[2]);
    if (d) found.add(d);
  }
  for (const m of line.matchAll(ISO)) {
    const d = iso(m[1], m[2], m[3]);
    if (d) found.add(d);
  }
  return [...found];
}

// Dates between `from` and `to` (YYYY-MM-DD) that sit on, or right after, a line about a sale.
export function saleDatesInText(text, { from, to }) {
  const lines = text.split("\n");
  const out = new Map();
  lines.forEach((line, i) => {
    if (line.length > 600) line = line.slice(0, 600);
    const dates = datesInLine(line).filter((d) => d >= from && d <= to);
    if (!dates.length || NOISE.test(line)) return;
    const near = [lines[i - 2], lines[i - 1], line].filter(Boolean).join(" ");
    if (!SALE_WORDS.test(near)) return;
    for (const d of dates) if (!out.has(d)) out.set(d, line.trim().slice(0, 240));
  });
  return [...out].map(([date, line]) => ({ date, line })).sort((a, b) => a.date.localeCompare(b.date));
}

// Dates the data already knows for a county: sales, sale end dates, registration cut-offs and
// sales we withheld on purpose.
export function knownDates(county) {
  const known = new Set();
  for (const s of county.sales || []) {
    for (const d of [s.date, s.end_date, s.register_by]) if (d) known.add(d);
    for (const d of datesInLine(`${s.registration_deadline || ""} ${s.note || ""} ${s.time || ""}`)) known.add(d);
  }
  for (const s of county.notes?.withheld_sales || []) if (s.date) known.add(s.date);
  for (const d of datesInLine(`${county.next_sale_note || ""} ${county.register_by || ""}`)) known.add(d);
  return known;
}

// Compares one county with the text of its source pages.
// texts: Map(url -> text). Returns { newDates, missing } where newDates are sale-looking dates on
// the county's pages that the data doesn't have, and missing are upcoming sale dates in the data
// that no longer appear on the page they cite (only when that page's text was read).
export function compareCounty(county, texts, { from, to }) {
  const known = knownDates(county);
  const newDates = new Map();
  // A statewide schedule lists many counties: skip lines that name a different county.
  const names = [county.county.replace(/\s*\(.*\)\s*$/, ""), ...(county.county.match(/\(([^)]+)\)/)?.[1].replace(/ County$/, "") ? [county.county.match(/\(([^)]+)\)/)[1].replace(/ County$/, "")] : [])]
    .map((n) => n.toLowerCase());
  const aboutOtherCounty = (line) => /\b[A-Z][\w.'\u00f1 -]* County\b/.test(line) && !names.some((n) => line.toLowerCase().includes(n));
  for (const s of county.sources || []) {
    const text = texts.get(s.url);
    if (!text) continue;
    for (const hit of saleDatesInText(text, { from, to })) {
      if (known.has(hit.date) || newDates.has(hit.date) || aboutOtherCounty(hit.line)) continue;
      newDates.set(hit.date, { ...hit, url: s.url });
    }
  }
  const missing = [];
  for (const sale of county.sales || []) {
    if ((sale.end_date || sale.date) < from) continue;
    const text = texts.get(sale.source_url);
    if (!text) continue;
    if (!mentionsDay(text, sale.date)) missing.push({ date: sale.date, label: sale.label, url: sale.source_url });
  }
  return { newDates: [...newDates.values()], missing };
}

// Whether a page mentions a date's month and day in any common form, with or without the year
// ("December 1 @ 9:00 am", "March 2nd", "12/01/26"). Used before calling a listed date missing,
// so a page that drops the year doesn't raise a false alarm.
export function mentionsDay(text, date) {
  const [, m, d] = date.split("-").map(Number);
  const name = MONTHS[m - 1];
  const named = new RegExp(`\\b${name}[a-z]*\\.?\\s+0?${d}\\s*(?:st|nd|rd|th)?\\b`, "i");
  // "15 December", "15th of December", "the 15th day of December, 2026" (Florida tax deed notices)
  const dayFirst = new RegExp(`\\b0?${d}\\s*(?:st|nd|rd|th)?\\s+(?:day\\s+)?(?:of\\s+)?${name}`, "i");
  const numeric = new RegExp(`\\b0?${m}[/-]0?${d}\\b`);
  // A range like "March 17-18" mentions the 18th too.
  const range = new RegExp(`\\b${name}[a-z]*\\.?\\s+\\d{1,2}\\s*(?:st|nd|rd|th)?\\s*[-\u2013]\\s*0?${d}\\b`, "i");
  return [named, dayFirst, numeric, range].some((re) => re.test(text)) || text.includes(date);
}

export function addDays(date, days) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
