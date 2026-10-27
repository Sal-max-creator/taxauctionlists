// Weekly source check. Fetches every source page in data/states, compares it with the last
// snapshot, and writes a Markdown report of what changed, which sales are coming up soon,
// and which listings are stale. It never edits sale data: a person reviews the report.
//
// Usage: node scripts/check-sources.mjs --snapshots <dir> --report <file>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readStateFiles, allSources, flattenSales, loadStates, today } from "./lib/data.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const snapDir = path.resolve(args.snapshots || ".source-check/snapshots");
const reportFile = path.resolve(args.report || "source-report.md");
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

for (const src of sources) {
  const host = new URL(src.url).host;
  const wait = (lastHit.get(host) || 0) + PER_HOST_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());

  const prev = previous[src.url];
  const result = { ...src, status: "unchanged" };
  try {
    if (!(await allowedByRobots(src.url))) {
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
        const text = toText(buf.toString("utf8"), type);
        const hash = sha(text ?? buf);
        const oldText = fs.existsSync(fileFor(src.url)) ? fs.readFileSync(fileFor(src.url), "utf8") : null;
        next[src.url] = { hash, checked_at: today(), content_type: type };
        if (text !== null) fs.writeFileSync(fileFor(src.url), text);
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

// Upcoming sales to re-check by hand, and listings not checked recently.
const now = today();
const daysUntil = (d) => Math.round((Date.parse(d) - Date.parse(now)) / 86400000);
const soon = flattenSales(loadStates()).filter((s) => daysUntil(s.date) <= 7);
const stale = readStateFiles().flatMap(({ data }) =>
  (data.counties || []).flatMap((c) =>
    (c.sources || []).filter((s) => daysUntil(s.read_on) < -STALE_DAYS).map((s) => ({ county: `${c.county}, ${data.state}`, ...s })),
  ),
);

const changed = results.filter((r) => r.status === "changed");
const errored = results.filter((r) => r.status === "error" || r.status === "skipped");
const fresh = results.filter((r) => r.status === "new");
const lines = [`# Source check ${now}`, ""];
lines.push(`Checked ${results.length} source pages: ${changed.length} changed, ${fresh.length} new baseline, ${errored.length} need a manual look.`, "");
if (soon.length) {
  lines.push("## Sales within 7 days: re-check the county page", "");
  for (const s of soon) lines.push(`- **${s.date}** (${daysUntil(s.date)} day(s)) ${s.county}, ${s.stateCode}: ${s.label || "sale"} — ${s.source_url}`);
  lines.push("");
}
if (changed.length) {
  lines.push("## Changed pages", "");
  for (const r of changed) {
    lines.push(`### ${r.url}`, "", `Backs: ${r.backs.join("; ") || "(overview)"}`, "");
    if (r.diff?.removed.length) lines.push("Removed lines:", "", ...r.diff.removed.map((l) => `- ~~${l.slice(0, 200)}~~`), "");
    if (r.diff?.added.length) lines.push("Added lines:", "", ...r.diff.added.map((l) => `- ${l.slice(0, 200)}`), "");
  }
}
if (errored.length) {
  lines.push("## Could not check automatically", "");
  for (const r of errored) lines.push(`- ${r.url}: ${r.note} (backs ${r.backs.join("; ")})`);
  lines.push("");
}
if (stale.length) {
  lines.push(`## Not re-read in over ${STALE_DAYS} days`, "");
  for (const s of stale) lines.push(`- ${s.county}: ${s.url} (last read ${s.read_on})`);
  lines.push("");
}
lines.push("After reviewing, update the affected entries in `data/states/*.json` (including `read_on`) in a pull request.");
fs.writeFileSync(reportFile, lines.join("\n") + "\n");

const needsReview = changed.length > 0 || soon.length > 0 || errored.length > 0 || stale.length > 0;
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `needs_review=${needsReview}\nchanged=${changed.length}\nsoon=${soon.length}\n`);
}
console.log(lines.slice(0, 3).join("\n"));
