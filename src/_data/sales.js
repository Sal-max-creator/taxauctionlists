import { loadStates, flattenSales } from "../../scripts/lib/data.mjs";

// Every dated sale across all states, soonest first. Past sales are dropped at build time.
export default function () {
  return flattenSales(loadStates());
}
