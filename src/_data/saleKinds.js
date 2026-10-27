import { loadStates, flattenSales } from "../../scripts/lib/data.mjs";

// The two landing pages by kind of sale. Hybrid states hold both kinds, so they appear on both.
const KINDS = [
  {
    key: "lien",
    url: "/tax-lien-sales/",
    title: "Tax lien sales",
    heading: "Upcoming tax lien sales",
    stateTypes: ["lien", "hybrid"],
    saleTypes: ["lien"],
    intro:
      "At a tax lien sale the county sells the right to collect unpaid property taxes, plus interest or penalties set by state law. You don't get the property unless the owner never pays and you follow the state's foreclosure steps.",
    guide: "/guides/how-tax-lien-certificates-work/",
  },
  {
    key: "deed",
    url: "/tax-deed-sales/",
    title: "Tax deed sales",
    heading: "Upcoming tax deed sales",
    stateTypes: ["deed", "redeemable deed", "hybrid"],
    saleTypes: ["deed", "redeemable deed"],
    intro:
      "At a tax deed sale the county sells the property itself to recover unpaid taxes. In some states the former owner can still buy it back for a set time after the sale (a redeemable deed).",
    guide: "/guides/how-tax-deed-sales-work/",
  },
];

export default function () {
  const states = loadStates();
  const sales = flattenSales(states);
  return KINDS.map((k) => ({
    ...k,
    states: states.filter((st) => k.stateTypes.includes(st.sale_type)),
    sales: sales.filter((s) => k.saleTypes.includes(s.saleType)),
  }));
}
