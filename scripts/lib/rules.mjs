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
