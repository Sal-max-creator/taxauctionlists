// Writes a draft of the weekly paid Alerts email as Markdown, for a person to review and paste into Buttondown.
// It never sends anything and needs no API key.
//
//   npm run alert-draft                      # next 30 days, changes since the commit from 7 days ago
//   npm run alert-draft -- --days 45 --since <git ref>
//   npm run alert-draft -- --site none       # don't link county names to our site (before the domain is live)
//
// "What changed" compares data/states/ now with the same files at the --since commit.
import { execFileSync } from "node:child_process";
import { loadStates, flattenSales, today } from "./lib/data.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const days = Number(args.days || 30);
const now = today();
const until = new Date(Date.parse(`${now}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
const siteUrl = args.site === "none" ? null : args.site || "https://taxauctionlists.com";
// County name, linked to its page on our site unless --site none.
const countyLink = (name, path) => (siteUrl ? `[${name}](${siteUrl}${path})` : `**${name}**`);

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
function sinceRef() {
  if (args.since) return args.since;
  try {
    return git("rev-list", "-1", "--before=7 days ago", "HEAD") || null;
  } catch {
    return null;
  }
}

// State files as they were at a commit, keyed by state code. Missing files (state added later) are skipped.
function statesAt(ref) {
  const out = {};
  let files = [];
  try {
    files = git("ls-tree", "--name-only", `${ref}:data/states`).split("\n").filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    const data = JSON.parse(git("show", `${ref}:data/states/${f}`));
    out[data.state] = data;
  }
  return out;
}

const fmt = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const states = loadStates();
const upcoming = flattenSales(states).filter((s) => s.date <= until);

// --- What changed since the earlier commit ---
const ref = sinceRef();
const changes = [];
if (ref) {
  const before = statesAt(ref);
  const watched = ["time", "deposit", "registration_deadline", "format", "end_date"];
  for (const st of states) {
    const old = before[st.state];
    for (const c of st.counties) {
      const oldCounty = old?.counties?.find((x) => x.slug === c.slug);
      const where = `${c.county}, ${st.state}`;
      if (!oldCounty) {
        if (old) changes.push(`- **${where}**: newly covered.`);
        continue;
      }
      const oldSales = (oldCounty.sales || []).filter((s) => (s.end_date || s.date) >= now);
      const newSales = c.upcoming;
      for (const s of newSales) {
        const prev = oldSales.find((o) => o.date === s.date && (o.label || "") === (s.label || ""));
        if (!prev) {
          changes.push(`- **${where}**: new date posted, ${s.label || "sale"} on ${fmt(s.date)}.`);
          continue;
        }
        for (const k of watched) {
          if ((prev[k] || "") !== (s[k] || "")) changes.push(`- **${where}**: ${s.label || "sale"} on ${fmt(s.date)}, ${k.replace("_", " ")} now "${s[k] || "not stated"}".`);
        }
      }
      for (const o of oldSales) {
        if (!newSales.some((s) => s.date === o.date && (s.label || "") === (o.label || ""))) {
          changes.push(`- **${where}**: ${o.label || "sale"} on ${fmt(o.date)} is no longer listed (moved or cancelled). Confirm with the county.`);
        }
      }
    }
  }
}

// --- Draft ---
// Deadlines use every future sale, so a sale just past the window still shows if you must register inside it.
const deadlines = flattenSales(states)
  .filter((s) => s.register_by && s.register_by >= now && s.register_by <= until)
  .sort((a, b) => a.register_by.localeCompare(b.register_by));
const datedCounties = new Set(upcoming.map((s) => `${s.stateCode}/${s.countySlug}`));
const recurring = states.flatMap((st) =>
  st.counties.filter((c) => c.recurs && !c.link_only && !datedCounties.has(`${st.state}/${c.slug}`)).map((c) => ({ ...c, stateName: st.name })),
);
const lists = upcoming.filter((s) => s.list_url);

const lines = [];
lines.push(`# Tax sales for the week of ${fmt(now)}`, "");
lines.push(`Every dated sale from ${fmt(now)} to ${fmt(until)}, and what changed since last week. Each line links to the county page it came from.`, "");

lines.push(`## Registration deadlines in the next ${days} days`, "");
if (!deadlines.length) lines.push(`No registration deadlines in the next ${days} days.`, "");
for (const s of deadlines) {
  lines.push(`- **${fmt(s.register_by)}**: ${countyLink(`${s.county}, ${s.stateCode}`, s.countyUrl)}, ${s.label || "sale"} on ${fmt(s.date)}${s.end_date ? ` to ${fmt(s.end_date)}` : ""}. ${s.registration_deadline || ""}`.trimEnd());
}
if (deadlines.length) lines.push("");

lines.push("## What changed", "");
if (!ref) lines.push("Nothing to compare with yet. This is the first week we have on record.", "");
else if (!changes.length) lines.push("No sales were added, moved or cancelled since last week.", "");
else lines.push(...changes, "");

lines.push(`## Coming up in the next ${days} days`, "");
if (!upcoming.length) lines.push("No dated sales in this window.", "");
for (const st of states) {
  const rows = upcoming.filter((s) => s.stateCode === st.state);
  if (!rows.length) continue;
  lines.push(`### ${st.name}`, "");
  for (const s of rows) {
    const bits = [
      `**${fmt(s.date)}${s.end_date ? ` to ${fmt(s.end_date)}` : ""}**${s.time ? `, ${s.time}` : ""}`,
      countyLink(s.county, s.countyUrl),
      `${s.label || "Sale"} (${s.saleType}, ${s.format})`,
    ];
    lines.push(`- ${bits.join(" · ")}`);
    if (s.deposit) lines.push(`  - Deposit: ${s.deposit}`);
    if (s.registration_deadline) lines.push(`  - Register: ${s.registration_deadline}`);
    if (s.note) lines.push(`  - Note: ${s.note}`);
    lines.push(`  - Source: [county page](${s.source_url}), checked ${s.lastChecked || "date unknown"}`);
  }
  lines.push("");
}

lines.push("## Recurring sales with no dates posted", "");
lines.push("These counties sell on a fixed schedule but don't post each date on their own pages. The schedule is quoted as the county states it; check the county page for the property list before each sale.", "");
if (!recurring.length) lines.push("None.", "");
for (const c of recurring) lines.push(`- ${countyLink(`${c.county}, ${c.stateCode}`, c.url)} (${c.recurs}): "${c.schedule_rule}" [County page](${c.website || c.sources[0].url})`);
if (recurring.length) lines.push("");

lines.push("## Parcel lists", "");
for (const s of lists) lines.push(`- [${s.county}, ${s.stateCode}](${s.list_url}): ${s.label || "sale"} on ${fmt(s.date)}${s.list_note ? `. ${s.list_note}` : ""}`);
if (lists.length) lines.push("");
lines.push("_Add by hand: attach a spreadsheet only for counties whose terms allow reuse; for the rest, link to the county's own list. Never copy from link-only sources._", "");
lines.push("---", "");
lines.push("Information only, not investment or legal advice. Sale dates, terms and deadlines change; always confirm with the county before you register or bid.");

process.stdout.write(lines.join("\n") + "\n");
