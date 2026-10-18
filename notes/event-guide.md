# Alternative Dublin Event Guide Generator

A small, static prototype that turns Alternative Dublin's weekly Google Sheet into fixed 1080 × 1350 Instagram carousel pages.

## What it does

- Reads the selected public Sheet tab through Google's GViz endpoint without authentication; the operator can enter its GID or paste its full tab URL.
- Falls back to CSV file upload or pasted CSV if Google access is blocked.
- Maps `DATE`, `NAME`, `LOCATION`, `START TIME`, `EVENT/TICKETS LINK`, `Instagram Link`, `Approved`, and `TOP PICKS` into normalized event records.
- Includes only rows marked `Approved = TRUE` when that column exists.
- Reads dated weekday separator rows and carries their date through the event rows beneath them.
- Groups approved events by their actual date and paginates by measured rendered height, once the guide's fonts have loaded, keeping an 84px guard above the footer (measured from where the last event ends, so Safari keeps it too).
- **Generate guide** reads the Sheet again and lays the guide out, keeping the days chosen; the pages also follow every choice by themselves.
- Audits the output so every selected event appears exactly once.
- Follows the AD system shared with Tape Type and Guide Studio (2 Oct 2026): its own margins (75px top and sides, 60px bottom), the brand colours (light `#f0f0f0`, yellow `#ffed1f`, dark `#101010`), 47px titles in Barlow GX 168 (about ExtraBold), time tags cut like Tape Type's labels and Guide Studio's page numbers (38px ExtraBold, `guide-time` in the shared tokens since 18 Oct 2026, when labels and page numbers went to 44 and the times stayed a size down; on yellow tape cut around each time by Tape Type's own generator, a different cut per event; Condensed since 5 Oct, the cut on the tag's free right end and its square left end on the margin; since 18 Oct 2026 the cut only adds, so the tape keeps its padding whole around every time and the column is 126px, and times drop their leading zero, 9:00 not 09:00, so the tapes vary with their content), and the graffiti Dublin footer mark.
- Shows every ignored row and the reason it was left out.
- Flags implausibly old, future, or overly broad date ranges and requires a human confirmation before export.
- Shows the local time of the most recent successful Sheet refresh.
- Exports one page as PNG or every page in a ZIP at either 1080 × 1350 (1×) or 2160 × 2700 (2×). Pages are named `01-monday.png`, and at 2× `01-monday@2x.png`; the ZIP takes the same `@2x` suffix (18 Oct 2026, the suffix every AD tool uses).

## Run locally

Serve the directory with any static file server. For example:

```sh
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

No install or build step is needed for local development. The two export helpers (`html2canvas` and `JSZip`) are version-pinned remote scripts. The GX fonts ship in `assets/fonts`; Google's static Barlow families load for the editor screens.

## Change the design

The fixed page measurements, type scale, spacing, and colors live in the `--guide-*` variables at the top of `styles.css`. The app reads those same computed tokens for preview scaling, pagination, and export, so CSS is the single source of truth.

Data parsing and normalization are in `core.js`. DOM height measurement, rendering, and export are kept as separate functions in `app.js`.

The time tags' tape comes from Tape Type's tape geometry, bundled unchanged into `vendor/tape.js` (`timeTagShape` in `core.js` cuts it; `createTimeTag` in `app.js` draws it as a PNG and places it). When Tape Type's cuts change, run `node scripts/sync-tape.mjs` (it reads `~/tape-generator`, or `TAPE_REPO`, at `origin/main`, and uses that repo's esbuild). The time column, `--guide-time-width`, fits `00:00` at the time size with its inset and the biggest cut. The figures start `TAG_INSET` (0.375em, core.js) in from the margin, the most tape a tag's square left end takes, so no tape crosses the margin: from 2 to 5 Oct the figures stood on the margin with the tape overhanging it, 11–24px nearer the edge, too near it in the feed.

The guide ships two width-pinned instances of the upstream experimental `BarlowGX.ttf` variable font: `BarlowGX-Normal.ttf` (wdth 500) and `BarlowGX-Condensed.ttf` (wdth 300), each keeping the native `wght 22–188` axis. Width is baked into the files rather than set via `font-variation-settings` in `@font-face`, because Safari and Chromium ≤139 ignore that descriptor and rendered (and exported) everything at the font's condensed default. The GX overrides near the bottom of `styles.css` set in-between weights rather than forcing them onto static 100-step weights: `168` for the titles and the footer title, `166` (ExtraBold, Condensed) for the time, `108` for the venue and handle (100 until 18 Oct 2026, when they also lost their −3% tracking). The footer date takes the AD footer style shared with Guide Studio: `108`, a notch under SemiBold (116 until 18 Oct 2026), Condensed, 42px (36 until 18 Oct 2026), the meta grey for light pages (`meta-on-light`, #666363 since 18 Oct 2026; #7f7c7c before), title case (“Mon 14 Sep”). Times and the date were normal width from 2 to 5 Oct 2026; they went back to Condensed, where space is at a premium. Edit those `font-weight` values by single units to tune both the browser preview and PNG export together. Exports check that both GX faces loaded and refuse otherwise: the static families would draw these sub-400 weights in Barlow Thin. Each time tag's tape is a PNG that `app.js` draws in `--guide-yellow`, because html2canvas draws neither `clip-path` nor masks, and Safari won't save an export that drew an SVG picture from a `data:` URL (the guide's exports broke that way on 2 Oct 2026; `tests/export-safety.test.js` keeps SVG data URLs out of the styles). To regenerate the instances from the master file: `fonttools varLib.instancer BarlowGX.ttf wdth=500 -o BarlowGX-Normal.ttf` (and `wdth=300` for the condensed one), then set `OS/2.usWidthClass` to 5 (Normal) / 3 (Condensed) — the instancer writes 9 for both because the font's width axis uses non-standard 300–500 values.

## Tests and build

```sh
npm test
npm run build
```

The build copies only the static production files into `dist/`, leaving out `assets/fonts/BarlowGX.ttf`, the master the two instances are cut from (18 Oct 2026).

## GitHub Pages

The workflow in `.github/workflows/pages.yml` mirrors the artifact-based deployment used by Tape Type: it tests, builds `dist/`, uploads the Pages artifact, and deploys on pushes to `main`.

After pushing to a new GitHub repository, choose **GitHub Actions** as the Pages source under **Settings → Pages**. For a repository named `event-guide`, the expected URL is `https://shaunphh.github.io/event-guide/`.

## Later

- Should the day sit at the top of the page, and with it the title it shares the footer's row with (Shaun, 5 Oct 2026)? Not decided; not started.

## Current Sheet assumptions

- Numeric dates are month/day, as in the current Sheet.
- GViz typed dates are preferred because they retain the otherwise hidden year.
- If the date column has a blank or generated header, the parser identifies it from the dated weekday rows.
- A blank event date inherits its weekday separator date or the most recent explicit date.
- A row is valid when it has a parseable date and event name, and is approved when the `Approved` column exists.
- Ticket fields that are descriptive text rather than an absolute HTTP(S) URL are retained as source text but are not treated as URLs.
- Missing time is shown as `TBC` rather than interpreted as an all-day event.
- A row whose `STATUS` says Cancelled or Postponed is left out and listed with the ignored rows (5 Oct 2026); the website shows such events marked instead, so the row stays in the Sheet. Sold out still goes in.
