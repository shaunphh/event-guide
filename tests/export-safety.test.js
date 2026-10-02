import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("the guide's styles draw no SVG images from data: URLs (Safari won't save the export)", () => {
  assert.doesNotMatch(styles, /data:image\/svg\+xml/i);
});
