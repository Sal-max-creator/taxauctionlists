import { loadStates } from "../../scripts/lib/data.mjs";

// Flat list used to paginate one page per county.
export default function () {
  return loadStates().flatMap((state) => state.counties.map((county) => ({ ...county, state })));
}
