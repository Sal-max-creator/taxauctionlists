export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });

  // "2026-11-05" -> "Thu, Nov 5, 2026". Dates are calendar days, so format in UTC.
  eleventyConfig.addFilter("longDate", (iso) => {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  });
  eleventyConfig.addFilter("shortDate", (iso) => {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  });
  eleventyConfig.addFilter("hostname", (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  });
  eleventyConfig.addFilter("capitalize", (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s));
  eleventyConfig.addFilter("head", (arr, n) => (arr || []).slice(0, n));
  eleventyConfig.addFilter("whereEq", (arr, key, value) => (arr || []).filter((x) => x[key] === value));
  eleventyConfig.addFilter("guidesSorted", (pages) => [...pages].sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99)));

  return {
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
