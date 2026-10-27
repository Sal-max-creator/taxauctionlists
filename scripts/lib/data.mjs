import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const statesDir = path.join(root, "data/states");

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function readStateFiles() {
  return fs
    .readdirSync(statesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: path.join(statesDir, f), data: JSON.parse(fs.readFileSync(path.join(statesDir, f), "utf8")) }));
}

// Loads state files and adds derived fields the templates use.
export function loadStates() {
  const now = today();
  return readStateFiles()
    .map(({ data }) => {
      const slug = data.state.toLowerCase();
      const counties = (data.counties || [])
        .map((c) => {
          const checks = (c.sources || []).map((s) => s.read_on).filter(Boolean).sort();
          const sales = (c.sales || []).filter((s) => s.date >= now).sort((a, b) => a.date.localeCompare(b.date));
          return {
            ...c,
            stateCode: data.state,
            stateName: data.name,
            stateSlug: slug,
            url: `/states/${slug}/${c.slug}/`,
            lastChecked: checks.at(-1) || null,
            upcoming: sales,
          };
        })
        .sort((a, b) => a.county.localeCompare(b.county));
      return { ...data, slug, url: `/states/${slug}/`, counties, upcomingCount: counties.reduce((n, c) => n + c.upcoming.length, 0) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function flattenSales(states) {
  return states
    .flatMap((st) =>
      st.counties.flatMap((c) =>
        c.upcoming.map((sale) => ({
          ...sale,
          county: c.county,
          countyUrl: c.url,
          stateCode: st.state,
          stateName: st.name,
          stateUrl: st.url,
          saleType: sale.sale_type || c.sale_type,
          format: sale.format || c.format,
          lastChecked: (c.sources || []).find((s) => s.url === sale.source_url)?.read_on || c.lastChecked,
        })),
      ),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.stateName.localeCompare(b.stateName));
}

// Every source URL in the data, with what it backs. Used by the weekly checker and the terms log.
export function allSources(states = readStateFiles().map((f) => f.data)) {
  const map = new Map();
  const add = (url, info) => {
    if (!url) return;
    const entry = map.get(url) || { url, terms: null, terms_url: null, read_on: null, backs: [] };
    if (info.terms && !entry.terms) entry.terms = info.terms;
    if (info.terms_url && !entry.terms_url) entry.terms_url = info.terms_url;
    if (info.read_on && (!entry.read_on || info.read_on > entry.read_on)) entry.read_on = info.read_on;
    if (info.backs) entry.backs.push(info.backs);
    map.set(url, entry);
  };
  for (const st of states) {
    for (const s of st.overview_sources || []) add(s.url, { backs: `${st.name} overview`, read_on: s.read_on });
    for (const c of st.counties || []) {
      for (const s of c.sources || []) add(s.url, { ...s, backs: `${c.county}, ${st.state}` });
      for (const sale of c.sales || []) add(sale.source_url, { backs: `${c.county}, ${st.state}: ${sale.label || "sale"} ${sale.date}` });
    }
  }
  return [...map.values()].sort((a, b) => a.url.localeCompare(b.url));
}
