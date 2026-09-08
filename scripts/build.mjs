import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const output = new URL("../dist/", import.meta.url);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const path of ["index.html", "styles.css", "app.js", "core.js", "assets"]) {
  const source = new URL(`../${path}`, import.meta.url);
  if (!existsSync(source)) continue;
  cpSync(source, new URL(path, output), { recursive: true });
}

