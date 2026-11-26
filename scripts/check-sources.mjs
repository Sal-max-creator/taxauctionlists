// Weekly source check. Fetches every source page in data/states, compares it with the last
// snapshot, and writes a Markdown report. The report leads with sale dates: counties whose own
// pages now show a date we don't list, and listed dates their page no longer shows. Below that
// come sales within 7 days, changed pages, pages it couldn't read and stale listings.
// It never edits sale data: a person reviews the report and updates data/states in a pull request.
//
// Usage: node scripts/check-sources.mjs --snapshots <dir> --report <file> [--issue <file>] [--dates-json <file>]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { readStateFiles, allSources, flattenSales, loadStates, today } from "./lib/data.mjs";
import { forbidsAutomation } from "./lib/rules.mjs";
import { compareCounty, addDays } from "./lib/date-scan.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const snapDir = path.resolve(args.snapshots || ".source-check/snapshots");
const reportFile = path.resolve(args.report || "source-report.md");
// A shorter copy for the GitHub issue, which can't take more than 65,536 characters.
const issueFile = args.issue ? path.resolve(args.issue) : null;
const datesJson = args["dates-json"] ? path.resolve(args["dates-json"]) : null;
const ISSUE_LIMIT = 60000;
const USER_AGENT = "TaxAuctionListsBot/0.1 (weekly check of public tax sale pages; +https://taxauctionlists.com/about/)";
const PER_HOST_DELAY_MS = 2000;
const STALE_DAYS = 30;

fs.mkdirSync(snapDir, { recursive: true });
const indexFile = path.join(snapDir, "index.json");
const previous = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : {};
const next = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const fileFor = (url) => path.join(snapDir, `${crypto.createHash("sha1").update(url).digest("hex")}.txt`);

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    return await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.8" }, redirect: "follow", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Minimal robots.txt check for "User-agent: *" and our own agent name.
const robotsCache = new Map();
async function allowedByRobots(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const res = await get(`${u.origin}/robots.txt`);
      if (res.ok) {
        let applies = false;
        for (const raw of (await res.text()).split(/\r?\n/)) {
          const line = raw.replace(/#.*/, "").trim();
          const [key, ...rest] = line.split(":");
          const value = rest.join(":").trim();
          if (/^user-agent$/i.test(key)) applies = value === "*" || /taxauctionlists/i.test(value);
          else if (applies && /^disallow$/i.test(key) && value) rules.push(value);
        }
      }
    } catch {
      rules = [];
    }
    robotsCache.set(u.origin, rules);
  }
  const p = u.pathname + u.search;
  return !robotsCache.get(u.origin).some((rule) => p.startsWith(rule.replace(/\*.*$/, "")));
}

// PDF notices (common in New Jersey and Pennsylvania) are read with pdftotext when it's installed.
const hasPdftotext = spawnSync("pdftotext", ["-v"]).status === 0;
function pdfToText(buf) {
  if (!hasPdftotext) return null;
  const r = spawnSync("pdftotext", ["-layout", "-q", "-", "-"], { input: buf, maxBuffer: 50 * 1024 * 1024, timeout: 60000 });
  if (r.status !== 0) return null;
  const text = r.stdout.toString("utf8").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  return text || null;
}

function toText(body, contentType) {
  if (!/html|xml/i.test(contentType)) return null;
  return body
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|tr|h[1-6]|section|article|table|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const DATEISH = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|deposit|regist|deadline|cancel|postpon/i;
function lineDiff(oldText, newText) {
  const a = new Set(oldText.split("\n"));
  const b = new Set(newText.split("\n"));
  const rank = (lines) => [...lines].sort((x, y) => Number(DATEISH.test(y)) - Number(DATEISH.test(x))).slice(0, 12);
  return { added: rank([...b].filter((l) => !a.has(l))), removed: rank([...a].filter((l) => !b.has(l))) };
}

const sources = allSources();
const lastHit = new Map();
const results = [];
const freshText = new Map(); // url -> text read this run

for (const src of sources) {
  const host = new URL(src.url).host;
  const wait = (lastHit.get(host) || 0) + PER_HOST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const prev = previous[src.url];
  const result = { ...src, status: "unchanged" };
  try {
    if (src.linkOnly) {
      result.status = "skipped";
      result.note = "link-only source (terms bar commercial reuse); check by hand";
    } else if (forbidsAutomation(src.url)) {
      result.status = "skipped";
      result.note = "site terms forbid automated tools; check by hand";
    } else if (!(await allowedByRobots(src.url))) {
      result.status = "skipped";
      result.note = "robots.txt disallows automated checks; check by hand";
    } else {
      const res = await get(src.url);
      if (!res.ok) {
        result.status = "error";
        result.note = `HTTP ${res.status}`;
      } else {
        const type = res.headers.get("content-type") || "";
        const buf = Buffer.from(await res.arrayBuffer());
        const text = /pdf/i.test(type) || src.url.toLowerCase().endsWith(".pdf") ? pdfToText(buf) : toText(buf.toString("utf8"), type);
        const hash = sha(text ?? buf);
        const oldText = fs.existsSync(fileFor(src.url)) ? fs.readFileSync(fileFor(src.url), "utf8") : null;
        next[src.url] = { hash, checked_at: today(), content_type: type };
        if (text !== null) {
          fs.writeFileSync(fileFor(src.url), text);
          freshText.set(src.url, text);
        }
        if (!prev) result.status = "new";
        else if (prev.hash !== hash) {
          result.status = "changed";
          if (text !== null && oldText !== null) result.diff = lineDiff(oldText, text);
        }
      }
    }
  } catch (err) {
    result.status = "error";
    result.note = err.name === "AbortError" ? "timed out" : err.message;
  }
  if (!next[src.url] && prev) next[src.url] = prev; // keep the last good snapshot on errors
  results.push(result);
}
fs.writeFileSync(indexFile, JSON.stringify(next, null, 2) + "\n");

// Sale dates: compare each county's listing with the text of its pages read this run.
const now = today();
const daysUntil = (d) => Math.round((Date.parse(d) - Date.parse(now)) / 86400000);
const window = { from: now, to: addDays(now, 400) };
const dateFlags = [];
for (const { data } of readStateFiles()) {
  for (const c of data.counties || []) {
    if (c.link_only) continue;
    const { newDates, missing } = compareCounty(c, freshText, window);
    if (newDates.length || missing.length) dateFlags.push({ state: data.state, county: c.county, slug: c.slug, newDates, missing });
  }
}
dateFlags.sort((a, b) => (a.newDates[0]?.date || a.missing[0]?.date || "9").localeCompare(b.newDates[0]?.date || b.missing[0]?.date || "9"));
if (datesJson) fs.writeFileSync(datesJson, JSON.stringify(dateFlags, null, 2) + "\n");

// Upcoming sales to re-check by hand, and listings not checked recently.
const soon = flattenSales(loadStates()).filter((s) => daysUntil(s.date) <= 7);
const stale = readStateFiles().flatMap(({ data }) =>
  (data.counties || []).flatMap((c) =>
    (c.sources || []).filter((s) => daysUntil(s.read_on) < -STALE_DAYS).map((s) => ({ county: `${c.county}, ${data.state}`, ...s })),
  ),
);

const changed = results.filter((r) => r.status === "changed");
const errored = results.filter((r) => r.status === "error" || r.status === "skipped");
const fresh = results.filter((r) => r.status === "new");
const head = [`# Source check ${now}`, ""];
head.push(
  `Checked ${results.length} source pages (${freshText.size} read as text${hasPdftotext ? ", PDFs included" : ", PDFs skipped"}): ` +
    `${dateFlags.length} place(s) with dates to review, ${changed.length} changed, ${fresh.length} new baseline, ${errored.length} need a manual look.`,
  "",
);

const dateLines = [];
if (dateFlags.length) {
  dateLines.push("## Dates to review", "", "Dates found on a county's own page that our listing doesn't have, and listed dates the cited page no longer shows. Confirm each on the page before changing `data/states`.", "");
  for (const f of dateFlags) {
    dateLines.push(`### ${f.county}, ${f.state}`, "");
    for (const d of f.newDates) dateLines.push(`- New on page: **${d.date}** — "${d.line.replace(/\|/g, "/")}" (${d.url})`);
    for (const m of f.missing) dateLines.push(`- No longer on page: **${m.date}** ${m.label || "sale"} (${m.url})`);
    dateLines.push("");
  }
}

const restLines = [];
if (soon.length) {
  restLines.push("## Sales within 7 days: re-check the county page", "");
  for (const s of soon) restLines.push(`- **${s.date}** (${daysUntil(s.date)} day(s)) ${s.county}, ${s.stateCode}: ${s.label || "sale"} — ${s.source_url}`);
  restLines.push("");
}
const changedLines = [];
if (changed.length) {
  changedLines.push("## Changed pages", "");
  for (const r of changed) {
    changedLines.push(`### ${r.url}`, "", `Backs: ${r.backs.join("; ") || "(overview)"}`, "");
    if (r.diff?.removed.length) changedLines.push("Removed lines:", "", ...r.diff.removed.map((l) => `- ~~${l.slice(0, 200)}~~`), "");
    if (r.diff?.added.length) changedLines.push("Added lines:", "", ...r.diff.added.map((l) => `- ${l.slice(0, 200)}`), "");
  }
}
const tailLines = [];
if (errored.length) {
  tailLines.push("## Could not check automatically", "");
  for (const r of errored) tailLines.push(`- ${r.url}: ${r.note} (backs ${r.backs.join("; ")})`);
  tailLines.push("");
}
if (stale.length) {
  tailLines.push(`## Not re-read in over ${STALE_DAYS} days`, "");
  for (const s of stale) tailLines.push(`- ${s.county}: ${s.url} (last read ${s.read_on})`);
  tailLines.push("");
}
const footer = ["After reviewing, update the affected entries in `data/states/*.json` (including `read_on`) in a pull request."];
fs.writeFileSync(reportFile, [...head, ...dateLines, ...restLines, ...changedLines, ...tailLines, ...footer].join("\n") + "\n");

// The issue leads with dates and sales within a week. Page diffs and the long lists go to the
// run summary only, so the issue stays under GitHub's size limit.
if (issueFile) {
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const more = [
    "## Everything else",
    "",
    `${changed.length} page(s) changed, ${errored.length} couldn't be checked automatically and ${stale.length} source(s) weren't re-read in over ${STALE_DAYS} days.` +
      (runUrl ? ` The full report is in the run summary: ${runUrl}` : ""),
    "",
    ...footer,
  ];
  let body = [...head, ...dateLines, ...restLines].join("\n");
  const room = ISSUE_LIMIT - more.join("\n").length - 200;
  if (body.length > room) body = body.slice(0, body.lastIndexOf("\n", room)) + "\n\n(List cut short; the rest is in the run summary.)\n";
  fs.writeFileSync(issueFile, body + "\n" + more.join("\n") + "\n");
}

const needsReview = dateFlags.length > 0 || soon.length > 0;
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `needs_review=${needsReview}\ndates=${dateFlags.length}\nchanged=${changed.length}\nsoon=${soon.length}\n`);
}
console.log(head.join("\n"));
