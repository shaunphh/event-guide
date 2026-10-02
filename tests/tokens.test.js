import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tokens = JSON.parse(read("vendor/ad-tokens.json"));
const css = read("vendor/ad-tokens.css");
const styles = read("styles.css");

test("the shared AD tokens reach the guide as CSS custom properties", () => {
  for (const token of tokens.color.tokens) assert.match(css, new RegExp(`--ad-${token.name}: ${token.value};`));
  for (const name of ["guide-title", "guide-meta", "guide-wordmark", "label", "footer"]) {
    const style = tokens.type.groups.flatMap((group) => group.styles).find((entry) => entry.name === name);
    assert.match(css, new RegExp(`--ad-${name}-size: ${style.fontSize};`));
    assert.match(css, new RegExp(`--ad-${name}-weight: ${style.fontWeight};`));
  }
  assert.match(css, /--ad-guide-footer-guard: 84px;/);
});

test("the guide's colours, sizes and weights come from the shared tokens", () => {
  for (const [guide, shared] of [["yellow", "yellow"], ["ink", "dark"], ["background", "light"], ["grey", "meta"], ["footer-ink", "dark"]]) {
    assert.match(styles, new RegExp(`--guide-${guide}: var\\(--ad-${shared}\\);`));
  }
  for (const used of ["--ad-guide-title-weight", "--ad-label-weight", "--ad-footer-weight", "--ad-footer-size", "--ad-guide-footer-guard"]) {
    assert.ok(styles.includes(`var(${used})`), used);
  }
  assert.match(read("index.html"), /<link rel="stylesheet" href="vendor\/ad-tokens\.css" \/>\s*<link rel="stylesheet" href="styles\.css" \/>/);
});
