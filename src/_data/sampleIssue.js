import fs from "node:fs";
import path from "node:path";

// The newest weekly Alerts draft in drafts/alerts/, shown publicly as a sample issue.
// Lines in italics that start with "_Add by hand" are notes for whoever sends the email, so they're dropped.
export default function () {
  const dir = path.resolve("drafts/alerts");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  if (!files.length) return null;
  const file = files.at(-1);
  const body = fs
    .readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("_Add by hand"))
    .join("\n")
    // The page has its own title, so the email's own "# ..." heading is dropped.
    .replace(/^# .*\n+/, "");
  return { date: file.slice(0, 10), body };
}
