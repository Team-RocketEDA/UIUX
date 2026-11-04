// The pictures a project already holds: what to show on its card, and how to serve them to the app.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const VIEW_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

const IMAGE = /\.(png|jpe?g|webp|svg)$/i;
const PREFERRED = ["renders", "docs/diagrams", "diagrams", "images", "architecture", "docs", "."];

// The best picture for a project's card: where people keep them first, and within that a top-level view.
export function previewFile(dir: string): string | undefined {
  for (const folder of PREFERRED) {
    const full = path.join(dir, folder);
    if (!existsSync(full)) continue;
    const images = readdirSync(full, { withFileTypes: true })
      .filter((entry) => entry.isFile() && IMAGE.test(entry.name))
      .map((entry) => entry.name);
    if (!images.length) continue;
    const rank = (name: string) => (/mac_array|top|chip|layout|arch/i.test(name) ? 0 : 1);
    const best = images.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
    return path.join(folder, best);
  }
  return undefined;
}

// Lowercase, hyphenated, and short enough to be a project name.
export function projectSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 5)
    .join("-")
    .slice(0, 36)
    .replace(/-+$/, "");
  return /^[a-z0-9]/.test(slug) ? slug : "project";
}
