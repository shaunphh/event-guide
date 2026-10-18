import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const output = new URL("../dist/", import.meta.url);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

// The GX master, assets/fonts/BarlowGX.ttf, is only the source the two width-pinned instances
// are cut from (notes/event-guide.md): the page never loads it, so it stays out of dist.
const shipped = (file) => !file.endsWith("/BarlowGX.ttf");

for (const path of ["index.html", "styles.css", "app.js", "core.js", "assets", "vendor"]) {
  const source = new URL(`../${path}`, import.meta.url);
  if (!existsSync(source)) continue;
  cpSync(source, new URL(path, output), { recursive: true, filter: shipped });
}

