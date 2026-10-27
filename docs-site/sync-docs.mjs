// Copies ../docs/*.md into the VitePress root before build, so docs/ stays the
// single source of truth (rendered on GitHub) and the site always ships fresh.
// Rewrites ../ links to GitHub blob URLs since those files live outside the
// site root.
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "docs");

// Internal engineering notes (backlog task numbering is for maintainers, not
// end users) — never published to the site.
const SITE_PAGES = new Set(["websocket-auth.md", "agent-enrollment.md"]);

for (const entry of await readdir(src)) {
  if (!SITE_PAGES.has(entry)) continue;
  const raw = await readFile(join(src, entry), "utf8");
  const fixed = raw
    .replaceAll("](../", "](https://github.com/nirjan-dev/servomon/blob/main/")
    .replaceAll(" (S1 PoC)", "")
    .replaceAll("web/test/s1-auth.test.mjs", "web/test/")
    .replaceAll("s1-auth.test.mjs", "test suite")
    .replaceAll("`pnpm test:s1`", "`pnpm test`");
  await writeFile(join(here, entry), fixed);
  console.log(`synced ${entry}`);
}

await mkdir(join(here, "public", "assets"), { recursive: true });
 for (const entry of await readdir(join(src, "assets"))) {
  if (entry.startsWith("s2-")) continue; // internal case-study evidence, not for the site
  await copyFile(join(src, "assets", entry), join(here, "public", "assets", entry));
  console.log(`synced assets/${entry}`);
}
