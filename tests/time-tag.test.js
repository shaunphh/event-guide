import test from "node:test";
import assert from "node:assert/strict";

import { seedForTag, timeTagShape } from "../core.js";

const inside = (point, polygon) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

test("time tags are cut around the time, each event its own cut, and never cut into the figures", () => {
  const shapes = new Set();
  for (let index = 0; index < 120; index += 1) {
    const text = ["11:00", "20:30", "TBC"][index % 3];
    const width = { "11:00": 84.8, "20:30": 100, TBC: 69 }[text];
    const tag = timeTagShape({ text, width, capHeight: 26.6, size: 38, seed: seedForTag(`Event ${index}|${text}`) });
    shapes.add(JSON.stringify(tag.points));
    for (const point of tag.points) {
      assert.ok(point.x >= 0 && point.x <= tag.width + 0.01 && point.y >= 0 && point.y <= tag.height + 0.01);
    }
    // The tape hugs the time: a little wider and taller than the figures, not a box of one size.
    assert.ok(tag.width > width + 15 && tag.width < width + 50, `${text} ${tag.width}`);
    assert.ok(tag.height > 40 && tag.height < 52, `${text} height ${tag.height}`);
    for (const y of [tag.baseline - 26, tag.baseline - 13, tag.baseline]) {
      for (let x = tag.textX + 1; x < tag.textX + width - 1; x += 4) assert.equal(inside({ x, y }, tag.points), true, `${text} seed ${index} at ${x},${y}`);
    }
  }
  assert.ok(shapes.size > 60, `only ${shapes.size} different cuts`);
});

test("a tag keeps its cut: the same event and time always give the same seed", () => {
  assert.equal(seedForTag("Song Cycle|20:00"), seedForTag("Song Cycle|20:00"));
  assert.notEqual(seedForTag("Song Cycle|20:00"), seedForTag("Song Cycle|20:15"));
  assert.ok(seedForTag("") >= 1);
});
