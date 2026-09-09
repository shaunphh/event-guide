import test from "node:test";
import assert from "node:assert/strict";

import {
  assessDateRange,
  filenameForPage,
  formatBadgeTime,
  formatDateHeading,
  formatFooterDate,
  groupEventsByDay,
  gvizTableToRows,
  normalizeRows,
  parseCsv,
  rowsFromCsv,
  validatePagination,
} from "../core.js";

test("CSV parser handles commas, newlines, and escaped quotes", () => {
  const rows = parseCsv('DATE,NAME,LOCATION\n02/10,"A, B","The ""Big"" Room"\n');
  assert.deepEqual(rows, [
    ["DATE", "NAME", "LOCATION"],
    ["02/10", "A, B", 'The "Big" Room'],
  ]);
});

test("real Sheet-shaped CSV skips weekday banners and normalizes approved events", () => {
  const csv = [
    "DATE,NAME,LOCATION,START TIME,EVENT/TICKETS LINK,Instagram Link,Approved,TOP PICKS",
    "MONDAY (6),,,,,,,",
    "02/10,Casual Choir,Whelan's,8:00 PM,Ticket text,savagesingingsessions,TRUE,TRUE",
    ",A carried-date event,Temple Bar,9:00 PM,https://example.com,@example,TRUE,FALSE",
    "02/11,Not approved,Somewhere,6:00 PM,,,FALSE,FALSE",
  ].join("\n");

  const result = normalizeRows(rowsFromCsv(csv), { now: new Date(2026, 8, 8) });
  assert.equal(result.rowsFound, 3);
  assert.equal(result.events.length, 2);
  assert.equal(result.ignored.length, 1);
  assert.deepEqual(result.ignored[0], {
    sourceRow: 5,
    title: "Not approved",
    reason: "not approved",
  });
  assert.equal(result.events[0].dateKey, "2025-02-10");
  assert.equal(result.events[1].dateKey, "2025-02-10");
  assert.equal(result.events[1].dateInferred, true);
  assert.equal(result.events[0].instagram, "@savagesingingsessions");
  assert.equal(result.events[0].url, "");
  assert.equal(result.events[1].url, "https://example.com/");
  assert.equal(formatDateHeading(result.events[0].date), "MONDAY 10 FEB");
});

test("GViz conversion retains typed event year and formatted time", () => {
  const table = gvizTableToRows({
    status: "ok",
    table: {
      cols: [
        { id: "A", label: "DATE", type: "date" },
        { id: "B", label: "NAME", type: "string" },
        { id: "C", label: "START TIME", type: "datetime" },
        { id: "D", label: "Approved", type: "boolean" },
      ],
      rows: [
        {
          c: [
            { v: "Date(2025,1,10)", f: "02/10" },
            { v: "Exhibition Slow Look" },
            { v: "Date(1899,11,30,11,30,0)", f: "11:30 AM" },
            { v: true, f: "TRUE" },
          ],
        },
      ],
    },
  });
  const result = normalizeRows(table);
  assert.equal(result.events[0].dateKey, "2025-02-10");
  assert.equal(result.events[0].time, "11:30 AM");
});

test("new weekly tab layout infers the blank date column and carries weekday dates", () => {
  const csv = [
    " ,NAME,LOCATION,START TIME,Instagram name,Approved,19 TOP PICKS",
    "CLICK HERE FOR EVENT FINDING RESOURCES,,,,,,",
    '"Mon, 14 Sep",Monday,,,,,',
    ",Fresh Pasta Making Workshop,Coopers Cross,11:00 AM,@theitalian_pastaproject,TRUE,FALSE",
    ",Guided Abbey Tour,Meetinghouse Lane,12:30 PM,@cd_heritage,TRUE,TRUE",
    '"Tue, 15 Sep",Tuesday,,,,,',
    ",Tuesday Event,Temple Bar,6:00 PM,@example,TRUE,FALSE",
  ].join("\n");

  const result = normalizeRows(rowsFromCsv(csv), { now: new Date(2026, 8, 9, 12) });
  assert.equal(result.schema.date, 0);
  assert.equal(result.rowsFound, 4);
  assert.equal(result.events.length, 3);
  assert.equal(result.ignored.length, 1);
  assert.equal(result.events[0].dateKey, "2026-09-14");
  assert.equal(result.events[0].dateInferred, true);
  assert.equal(result.events[1].dateKey, "2026-09-14");
  assert.equal(result.events[2].dateKey, "2026-09-15");
});

test("new weekly GViz layout retains the typed year from a weekday separator row", () => {
  const table = gvizTableToRows({
    status: "ok",
    table: {
      cols: [
        { id: "A", label: "", type: "date" },
        { id: "B", label: "NAME", type: "string" },
        { id: "C", label: "LOCATION", type: "string" },
        { id: "D", label: "START TIME", type: "datetime" },
        { id: "E", label: "Approved", type: "boolean" },
      ],
      rows: [
        {
          c: [
            { v: "Date(2026,8,14)", f: "Mon, 14 Sep" },
            { v: "Monday" },
            null,
            null,
            null,
          ],
        },
        {
          c: [
            null,
            { v: "Fresh Pasta Making Workshop" },
            { v: "Coopers Cross" },
            { v: "Date(1899,11,30,11,0,0)", f: "11:00 AM" },
            { v: true, f: "TRUE" },
          ],
        },
      ],
    },
  });

  const result = normalizeRows(table, { now: new Date(2026, 8, 9, 12) });
  assert.equal(result.schema.date, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].dateKey, "2026-09-14");
  assert.equal(result.events[0].time, "11:00 AM");
});

test("rows are all included when an Approved column is absent", () => {
  const result = normalizeRows(
    rowsFromCsv("Date,Title,Venue,Time\n2026-09-07,One,Venue A,18:00\n2026-09-08,Two,Venue B,19:00"),
  );
  assert.equal(result.events.length, 2);
  assert.equal(result.ignored.length, 0);
  assert.equal(groupEventsByDay(result.events).length, 2);
});

test("pagination audit catches missing and duplicate event ids", () => {
  const events = [{ id: "one" }, { id: "two" }, { id: "three" }];
  const good = validatePagination(events, [
    { events: [events[0], events[1]] },
    { events: [events[2]] },
  ]);
  assert.equal(good.passed, true);
  assert.equal(good.rendered, 3);

  const bad = validatePagination(events, [{ events: [events[0], events[0], events[2]] }]);
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.missing, ["two"]);
  assert.deepEqual(bad.duplicates, ["one"]);
});

test("filenames are padded and day-based", () => {
  assert.equal(filenameForPage(0, 17, "MONDAY"), "01-monday.png");
  assert.equal(filenameForPage(16, 17, "TUESDAY"), "17-tuesday.png");
});

test("guide display formatting matches the compact Figma labels", () => {
  const monday = new Date(2025, 1, 10, 12);
  assert.equal(formatFooterDate(monday), "Mon 10 feb");
  assert.equal(formatBadgeTime("11:30 AM"), "11:30");
  assert.equal(formatBadgeTime("8:00 PM"), "20:00");
  assert.equal(formatBadgeTime("12 AM"), "00:00");
  assert.equal(formatBadgeTime("TBC"), "TBC");
});

test("date-range safeguard flags stale weeks but allows a current week", () => {
  const now = new Date(2026, 8, 9, 12);
  const stale = assessDateRange(
    [new Date(2025, 1, 10), new Date(2025, 1, 16)].map((date) => ({ date })),
    now,
  );
  assert.equal(stale.requiresConfirmation, true);
  assert.equal(stale.label, "10–16 Feb 2025");
  assert.match(stale.reason, /past/);

  const current = assessDateRange(
    [new Date(2026, 8, 8), new Date(2026, 8, 14)].map((date) => ({ date })),
    now,
  );
  assert.equal(current.requiresConfirmation, false);
});
