// Hosts we may link to but must never use as the source of a sale date or copy data from.
// Private auction platforms (no reuse terms found) and sites whose terms forbid reuse.
export const LINK_ONLY_HOSTS = [
  "realauction.com",
  "realtaxdeed.com",
  "realtaxlien.com",
  "realforeclose.com",
  "bid4assets.com",
  "govease.com",
  "zeusauction.com",
  "sriservices.com",
  "lienhub.com",
  "grantstreet.com",
  "govdeals.com",
  "publicsurplus.com",
  "wisconsinsurplus.com",
  "marylandtaxsale.com",
  "aarauctions.com",
  "auctionsinternational.com",
  "mnbid.mn.gov",
  "newjerseytaxsale.com",
  "sheriffsaleauction.ohio.gov",
  "sheriffsaleauctions.com",
  "coloradotaxsale.com",
  "arizonataxsale.com",
  "deedauction.net",
  "clerkauction.com",
  "itm.leoncountyfl.gov",
  "sdat.dat.maryland.gov",
];

export function isLinkOnly(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LINK_ONLY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// Hosts whose terms forbid automated tools or spiders. We may cite them, but the weekly
// checker never fetches them; it lists them for a manual look instead.
export const NO_AUTOMATION_HOSTS = ["iowataxandtags.org", "polkclerkfl.gov"];

export function forbidsAutomation(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return NO_AUTOMATION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
