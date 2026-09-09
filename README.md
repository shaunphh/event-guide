# Alternative Dublin Event Guide Generator

A small, static prototype that turns Alternative Dublin's weekly Google Sheet into fixed 1080 × 1350 Instagram carousel pages.

## What it does

- Reads the selected public Sheet tab through Google's GViz endpoint without authentication; the operator can enter its GID or paste its full tab URL.
- Falls back to CSV file upload or pasted CSV if Google access is blocked.
- Maps `DATE`, `NAME`, `LOCATION`, `START TIME`, `EVENT/TICKETS LINK`, `Instagram Link`, `Approved`, and `TOP PICKS` into normalized event records.
- Includes only rows marked `Approved = TRUE` when that column exists.
- Reads dated weekday separator rows and carries their date through the event rows beneath them.
- Groups approved events by their actual date and paginates by measured rendered height.
- Audits the output so every selected event appears exactly once.
- Matches the supplied Alternative Dublin Figma system: 50px margins, 44px Barlow Black titles, compact yellow time badges, and the supplied graffiti Dublin footer mark.
- Shows every ignored row and the reason it was left out.
- Flags implausibly old, future, or overly broad date ranges and requires a human confirmation before export.
- Shows the local time of the most recent successful Sheet refresh.
- Exports one page as PNG or every page in a ZIP at either 1080 × 1350 (1×) or 2160 × 2700 (2×).

## Run locally

Serve the directory with any static file server. For example:

```sh
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

No install or build step is needed for local development. The two export helpers (`html2canvas` and `JSZip`) and the Barlow fonts are version-pinned remote assets.

## Change the design

The fixed page measurements, type scale, spacing, and colors live in the `--guide-*` variables at the top of `styles.css`. The app reads those same computed tokens for preview scaling, pagination, and export, so CSS is the single source of truth.

Data parsing and normalization are in `core.js`. DOM height measurement, rendering, and export are kept as separate functions in `app.js`.

The guide includes the upstream experimental `BarlowGX.ttf` variable font. Its native axes are `wght 22–188` and `wdth 300–500`. The GX overrides near the bottom of `styles.css` set the title, time, and metadata to in-between weights (`154`, `129`, and `84`) rather than forcing them onto static 100-step weights. Edit those `font-weight` values by single units to tune both the browser preview and PNG export together. Export-safe `@font-face` rules retain the normal/condensed width axis, while the complete Google Fonts static families remain loaded as fallbacks.

## Tests and build

```sh
npm test
npm run build
```

The build copies only the static production files into `dist/`.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` mirrors the artifact-based deployment used by Tape Type: it tests, builds `dist/`, uploads the Pages artifact, and deploys on pushes to `main`.

After pushing to a new GitHub repository, choose **GitHub Actions** as the Pages source under **Settings → Pages**. For a repository named `event-guide`, the expected URL is `https://shaunphh.github.io/event-guide/`.

## Current Sheet assumptions

- Numeric dates are month/day, as in the current Sheet.
- GViz typed dates are preferred because they retain the otherwise hidden year.
- If the date column has a blank or generated header, the parser identifies it from the dated weekday rows.
- A blank event date inherits its weekday separator date or the most recent explicit date.
- A row is valid when it has a parseable date and event name, and is approved when the `Approved` column exists.
- Ticket fields that are descriptive text rather than an absolute HTTP(S) URL are retained as source text but are not treated as URLs.
- Missing time is shown as `TBC` rather than interpreted as an all-day event.
