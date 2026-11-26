import { loadStates } from "../../scripts/lib/data.mjs";
import { countyPageFields } from "../../scripts/lib/county-page.mjs";

// Flat list used to paginate one page per county, with the page text built from each county's own data.
export default function () {
  return loadStates().flatMap((state) => state.counties.map((county) => ({ ...county, state, page: countyPageFields(county, state) })));
}
