import { loadStates, flattenSales } from "../../scripts/lib/data.mjs";

// One entry per calendar month that has a dated sale, for the /tax-sales/<yyyy-mm>/ pages.
// A sale that runs across months is listed in the month it starts.
export default function () {
  const byMonth = new Map();
  for (const s of flattenSales(loadStates())) {
    const ym = s.date.slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym).push(s);
  }
  return [...byMonth.entries()].map(([ym, sales]) => ({
    ym,
    url: `/tax-sales/${ym}/`,
    sales,
    stateCount: new Set(sales.map((s) => s.stateCode)).size,
  }));
}
