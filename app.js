import {
  assessDateRange,
  filenameForPage,
  formatBadgeTime,
  formatDateHeading,
  formatDay,
  formatDayShort,
  formatFooterDate,
  groupEventsByDay,
  gvizTableToRows,
  normalizeRows,
  rowsFromCsv,
  validatePagination,
} from "./core.js";

function readCssToken(styles, token) {
  const value = styles.getPropertyValue(token).trim();
  if (!value) throw new Error(`Missing required design token: ${token}`);
  return value;
}

function readCssPixels(styles, token) {
  const value = Number.parseFloat(readCssToken(styles, token));
  if (!Number.isFinite(value)) throw new Error(`Invalid pixel design token: ${token}`);
  return value;
}

// styles.css is the single source of truth for canvas, type, spacing, and color tokens.
const designStyles = getComputedStyle(document.documentElement);
export const DESIGN = Object.freeze({
  pageWidth: readCssPixels(designStyles, "--guide-width"),
  pageHeight: readCssPixels(designStyles, "--guide-height"),
  paddingX: readCssPixels(designStyles, "--guide-padding-x"),
  paddingTop: readCssPixels(designStyles, "--guide-padding-top"),
  paddingBottom: readCssPixels(designStyles, "--guide-padding-bottom"),
  footerHeight: readCssPixels(designStyles, "--guide-footer-height"),
  eventGap: readCssPixels(designStyles, "--guide-event-gap"),
  timeWidth: readCssPixels(designStyles, "--guide-time-width"),
  columnGap: readCssPixels(designStyles, "--guide-column-gap"),
  eventTitleSize: readCssPixels(designStyles, "--guide-event-title-size"),
  eventMetaSize: readCssPixels(designStyles, "--guide-event-meta-size"),
  titleWidth: readCssPixels(designStyles, "--guide-title-width"),
  colors: Object.freeze({
    background: readCssToken(designStyles, "--guide-background"),
    ink: readCssToken(designStyles, "--guide-ink"),
    grey: readCssToken(designStyles, "--guide-grey"),
    yellow: readCssToken(designStyles, "--guide-yellow"),
    footerInk: readCssToken(designStyles, "--guide-footer-ink"),
  }),
});

const SHEET = Object.freeze({
  id: "1rXUChbT3TuOI3b7NaXpXudph96BhLCfEneSjcGW6kp4",
});
const DEFAULT_SHEET_GID = "170814515";
const SHEET_GID_STORAGE_KEY = "alternative-dublin-event-guide-sheet-gid";

const state = {
  dataset: null,
  events: [],
  selectedDates: new Set(),
  pages: [],
  integrity: null,
  source: "",
  loading: false,
  exporting: false,
  refreshedAt: null,
  dateRisk: null,
  datesConfirmed: false,
  sheetGid: DEFAULT_SHEET_GID,
  generationToken: 0,
  loadToken: 0,
};

const byId = (id) => document.getElementById(id);
const DOM = {
  loadSheet: byId("load-sheet"),
  refreshSheet: byId("refresh-sheet"),
  sheetGid: byId("sheet-gid"),
  sourceBadge: byId("source-badge"),
  sourceMessage: byId("source-message"),
  dataInspector: byId("data-inspector"),
  rowsFound: byId("rows-found"),
  eventsValid: byId("events-valid"),
  rowsIgnored: byId("rows-ignored"),
  dayCounts: byId("day-counts"),
  ignoredDetails: byId("ignored-details"),
  ignoredDetailCount: byId("ignored-detail-count"),
  ignoredList: byId("ignored-list"),
  dateCheck: byId("date-check"),
  dateCheckMessage: byId("date-check-message"),
  confirmDates: byId("confirm-dates"),
  csvFallback: byId("csv-fallback"),
  csvFile: byId("csv-file"),
  csvPaste: byId("csv-paste"),
  loadPastedCsv: byId("load-pasted-csv"),
  dayFilters: byId("day-filters"),
  selectAllDays: byId("select-all-days"),
  selectNoDays: byId("select-no-days"),
  manualLimitField: byId("manual-limit-field"),
  manualLimit: byId("manual-limit"),
  showVenue: byId("show-venue"),
  showInstagram: byId("show-instagram"),
  generateGuide: byId("generate-guide"),
  exportAll: byId("export-all"),
  exportStatus: byId("export-status"),
  selectedEventCount: byId("selected-event-count"),
  pageCount: byId("page-count"),
  integrityStatus: byId("integrity-status"),
  previewPageCount: byId("preview-page-count"),
  previewGrid: byId("preview-grid"),
  measureStage: byId("measure-stage"),
  exportStage: byId("export-stage"),
};

let generationTimer = 0;

function setSourceState(kind, badge, message) {
  DOM.sourceBadge.className = `status-badge status-badge--${kind}`;
  DOM.sourceBadge.textContent = badge;
  DOM.sourceMessage.textContent = message;
  DOM.sourceMessage.classList.toggle("source-message--error", kind === "error");
}

function parseSheetGid(value) {
  const input = String(value ?? "").trim();
  if (/^\d+$/.test(input)) return input;

  try {
    const url = new URL(input);
    if (!url.pathname.includes(`/spreadsheets/d/${SHEET.id}/`)) {
      throw new Error("That URL is for a different Google Sheet.");
    }
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const gid = url.searchParams.get("gid") || hashParams.get("gid") || "";
    if (/^\d+$/.test(gid)) return gid;
  } catch (error) {
    if (error.message === "That URL is for a different Google Sheet.") throw error;
  }

  throw new Error("Enter the tab GID number, or paste a tab URL from this Google Sheet.");
}

function restoreSheetGid() {
  try {
    return parseSheetGid(window.localStorage.getItem(SHEET_GID_STORAGE_KEY) || DEFAULT_SHEET_GID);
  } catch {
    return DEFAULT_SHEET_GID;
  }
}

function saveSheetGid(gid) {
  try {
    window.localStorage.setItem(SHEET_GID_STORAGE_KEY, gid);
  } catch {
    // The input still works when browser storage is unavailable.
  }
}

function loadSheetViaGviz(gid) {
  return new Promise((resolve, reject) => {
    const callbackName = `__eventGuide_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => finish(new Error("Google Sheet request timed out.")), 10000);

    function finish(error, value) {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
      if (error) reject(error);
      else resolve(value);
    }

    window[callbackName] = (response) => {
      try {
        finish(null, gvizTableToRows(response));
      } catch (error) {
        finish(error);
      }
    };

    const tqx = `out:json;responseHandler:${callbackName}`;
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET.id}/gviz/tq?gid=${gid}&headers=1&tqx=${encodeURIComponent(tqx)}&t=${Date.now()}`;
    script.onerror = () => finish(new Error("Google's public GViz endpoint was blocked."));
    script.referrerPolicy = "no-referrer";
    document.head.appendChild(script);
  });
}

async function loadSheetViaCsv(gid) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET.id}/export?format=csv&gid=${gid}&t=${Date.now()}`;
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Google returned ${response.status}.`);
    return rowsFromCsv(await response.text());
  } finally {
    window.clearTimeout(timeout);
  }
}

function renderInspector() {
  const dataset = state.dataset;
  if (!dataset) return;
  DOM.dataInspector.hidden = false;
  DOM.rowsFound.textContent = dataset.rowsFound;
  DOM.eventsValid.textContent = dataset.events.length;
  DOM.rowsIgnored.textContent = dataset.ignored.length;
  DOM.dayCounts.replaceChildren();
  DOM.ignoredList.replaceChildren();
  DOM.ignoredDetailCount.textContent = dataset.ignored.length;
  DOM.ignoredDetails.hidden = dataset.ignored.length === 0;

  groupEventsByDay(dataset.events).forEach((group) => {
    const item = document.createElement("li");
    const day = document.createElement("span");
    const count = document.createElement("strong");
    day.textContent = `${formatDayShort(group.date)} ${group.date.getDate()}`;
    count.textContent = group.events.length;
    item.append(day, count);
    DOM.dayCounts.appendChild(item);
  });

  dataset.ignored.forEach((ignored) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const reason = document.createElement("span");
    title.textContent = ignored.title;
    reason.textContent = `Sheet row ${ignored.sourceRow} · ${ignored.reason.replace(/^./, (letter) => letter.toUpperCase())}`;
    item.append(title, reason);
    DOM.ignoredList.appendChild(item);
  });
}

function renderDateCheck(selectedEvents = getSelectedEvents()) {
  state.dateRisk = assessDateRange(selectedEvents);
  const risk = state.dateRisk;
  DOM.dateCheck.hidden = !risk.requiresConfirmation;
  DOM.confirmDates.checked = state.datesConfirmed;
  if (risk.requiresConfirmation) {
    DOM.dateCheckMessage.textContent = `${risk.label}. ${risk.reason} Confirm before exporting.`;
  } else {
    DOM.dateCheckMessage.textContent = "";
  }
}

function formatRefreshTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function renderDayFilters() {
  DOM.dayFilters.replaceChildren();
  const groups = groupEventsByDay(state.events);
  if (!groups.length) {
    const note = document.createElement("span");
    note.className = "muted";
    note.textContent = "No valid days found.";
    DOM.dayFilters.appendChild(note);
    return;
  }

  groups.forEach((group) => {
    const label = document.createElement("label");
    label.className = "day-filter";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = group.key;
    input.checked = state.selectedDates.has(group.key);
    input.addEventListener("change", () => {
      if (input.checked) state.selectedDates.add(group.key);
      else state.selectedDates.delete(group.key);
      scheduleGuide();
    });
    const text = document.createElement("span");
    const name = document.createTextNode(formatDayShort(group.date));
    const count = document.createElement("em");
    count.textContent = group.events.length;
    text.append(name, count);
    label.append(input, text);
    DOM.dayFilters.appendChild(label);
  });
}

function readSettings() {
  const mode = document.querySelector('input[name="page-mode"]:checked')?.value || "auto";
  return {
    mode,
    manualLimit: Math.max(1, Math.min(30, Number(DOM.manualLimit.value) || 8)),
    showVenue: DOM.showVenue.checked,
    showInstagram: DOM.showInstagram.checked,
  };
}

function readExportScale() {
  return Number(document.querySelector('input[name="export-scale"]:checked')?.value) === 2 ? 2 : 1;
}

function getSelectedEvents() {
  return state.events.filter((event) => state.selectedDates.has(event.dateKey));
}

function createEventElement(event, settings) {
  const item = document.createElement("article");
  item.className = "guide-event";
  item.dataset.eventId = event.id;

  const time = document.createElement("time");
  time.className = "guide-event__time";
  time.textContent = formatBadgeTime(event.time);
  if (time.textContent !== event.time) {
    time.title = event.time;
    time.setAttribute("aria-label", event.time);
  }

  const body = document.createElement("div");
  body.className = "guide-event__body";
  const title = document.createElement("h3");
  title.className = "guide-event__title";
  title.textContent = event.title;
  body.appendChild(title);

  const metadata = [];
  if (settings.showVenue && event.venue) metadata.push(["guide-event__venue", event.venue]);
  if (settings.showInstagram && event.instagram) metadata.push(["guide-event__instagram", event.instagram]);
  if (metadata.length) {
    const meta = document.createElement("p");
    meta.className = "guide-event__meta";
    metadata.forEach(([className, value]) => {
      const part = document.createElement("span");
      part.className = className;
      part.textContent = value;
      meta.appendChild(part);
    });
    body.appendChild(meta);
  }

  item.append(time, body);
  return item;
}

function createGuidePage(page, settings) {
  const element = document.createElement("article");
  element.className = "guide-page";
  element.setAttribute("aria-label", `${formatDateHeading(page.date)}, page ${page.dayPage} of ${page.dayPages}`);
  element.dataset.pageIndex = page.globalIndex;

  const list = document.createElement("div");
  list.className = "guide-page__events";
  page.events.forEach((event) => list.appendChild(createEventElement(event, settings)));

  const footer = document.createElement("footer");
  footer.className = "guide-page__footer";
  const lockup = document.createElement("div");
  lockup.className = "guide-page__footer-lockup";
  const mark = document.createElement("img");
  mark.className = "guide-page__dublin-mark";
  mark.src = "assets/DublinEventGuide.svg";
  mark.alt = "Dublin";
  mark.width = 144;
  mark.height = 62;
  const footerTitle = document.createElement("span");
  footerTitle.className = "guide-page__footer-title";
  footerTitle.textContent = "Event Guide";
  lockup.append(mark, footerTitle);
  const footerDate = document.createElement("time");
  footerDate.className = "guide-page__footer-date";
  footerDate.dateTime = page.key || "";
  footerDate.textContent = formatFooterDate(page.date);
  footer.append(lockup, footerDate);
  element.append(list, footer);
  return element;
}

function createMeasurementPage(date, settings) {
  const page = {
    date,
    events: [],
    dayPage: 1,
    dayPages: 1,
    globalIndex: 0,
  };
  const element = createGuidePage(page, settings);
  DOM.measureStage.replaceChildren(element);
  return { element, list: element.querySelector(".guide-page__events") };
}

function paginateByRenderedHeight(events, settings) {
  const pages = [];
  groupEventsByDay(events).forEach((group) => {
    const dayPages = [];
    let pageEvents = [];
    let measurement = createMeasurementPage(group.date, settings);

    const commitPage = () => {
      if (!pageEvents.length) return;
      dayPages.push({ key: group.key, date: group.date, events: [...pageEvents] });
      pageEvents = [];
      measurement = createMeasurementPage(group.date, settings);
    };

    group.events.forEach((event) => {
      if (settings.mode === "manual" && pageEvents.length >= settings.manualLimit) commitPage();

      const eventElement = createEventElement(event, settings);
      measurement.list.appendChild(eventElement);
      const overflows = measurement.list.scrollHeight > measurement.list.clientHeight + 1;

      if (overflows && pageEvents.length) {
        eventElement.remove();
        commitPage();
        measurement.list.appendChild(createEventElement(event, settings));
      }
      pageEvents.push(event);
    });

    if (pageEvents.length) dayPages.push({ key: group.key, date: group.date, events: [...pageEvents] });
    dayPages.forEach((page, index) => {
      page.dayPage = index + 1;
      page.dayPages = dayPages.length;
      pages.push(page);
    });
  });

  DOM.measureStage.replaceChildren();
  pages.forEach((page, index) => {
    page.globalIndex = index;
    page.filename = filenameForPage(index, pages.length, formatDay(page.date));
  });
  return pages;
}

function scalePageFrame(frame) {
  const scale = frame.clientWidth / DESIGN.pageWidth;
  frame.style.height = `${DESIGN.pageHeight * scale}px`;
  frame.querySelector(".guide-page")?.style.setProperty("--preview-scale", String(scale));
}

const frameObserver = new ResizeObserver((entries) => {
  entries.forEach((entry) => scalePageFrame(entry.target));
});

function filenameAtScale(filename, scale = readExportScale()) {
  return scale === 2 ? filename.replace(/\.png$/i, "@2x.png") : filename;
}

function canExport() {
  return Boolean(
    state.pages.length &&
      state.integrity?.passed &&
      !state.exporting &&
      (!state.dateRisk?.requiresConfirmation || state.datesConfirmed),
  );
}

function syncExportControls() {
  const scale = readExportScale();
  const enabled = canExport();
  DOM.exportAll.disabled = !enabled;
  DOM.generateGuide.disabled = state.exporting || !state.events.length;
  DOM.exportAll.textContent = scale === 2 ? "Export all @2× (.zip)" : "Export all (.zip)";
  document.querySelectorAll('input[name="export-scale"]').forEach((input) => {
    input.disabled = state.exporting;
  });
  document.querySelectorAll(".page-card").forEach((card) => {
    const filename = card.querySelector(".page-card__toolbar span");
    const button = card.querySelector(".page-card__toolbar button");
    if (filename?.dataset.baseFilename) filename.textContent = filenameAtScale(filename.dataset.baseFilename, scale);
    if (button) {
      button.disabled = !enabled;
      button.textContent = scale === 2 ? "Export PNG @2×" : "Export PNG";
    }
  });
}

function renderPages(settings) {
  DOM.previewGrid.querySelectorAll(".page-frame").forEach((frame) => frameObserver.unobserve(frame));
  DOM.previewGrid.replaceChildren();
  if (!state.pages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const number = document.createElement("span");
    number.className = "empty-state__number";
    number.textContent = "00";
    const title = document.createElement("h3");
    title.textContent = state.events.length ? "Select at least one day." : "Load the Sheet to generate the guide.";
    const note = document.createElement("p");
    note.textContent = "Every page will appear here at preview scale.";
    empty.append(number, title, note);
    DOM.previewGrid.appendChild(empty);
    return;
  }

  state.pages.forEach((page, index) => {
    const card = document.createElement("div");
    card.className = "page-card";
    const toolbar = document.createElement("div");
    toolbar.className = "page-card__toolbar";
    const filename = document.createElement("span");
    filename.textContent = page.filename;
    filename.dataset.baseFilename = page.filename;
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export PNG";
    exportButton.setAttribute("aria-label", `Export ${page.filename}`);
    exportButton.addEventListener("click", () => exportSinglePage(index));
    toolbar.append(filename, exportButton);

    const frame = document.createElement("div");
    frame.className = "page-frame";
    frame.appendChild(createGuidePage(page, settings));
    card.append(toolbar, frame);
    DOM.previewGrid.appendChild(card);
    scalePageFrame(frame);
    frameObserver.observe(frame);
  });
  syncExportControls();
}

function updateSummary(selectedEvents) {
  renderDateCheck(selectedEvents);
  DOM.selectedEventCount.textContent = selectedEvents.length;
  DOM.pageCount.textContent = state.pages.length;
  DOM.previewPageCount.textContent = state.pages.length ? `${state.pages.length} pages` : "No pages";
  syncExportControls();

  DOM.integrityStatus.className = "integrity-status";
  if (!selectedEvents.length) {
    DOM.integrityStatus.textContent = "Select one or more days to generate pages.";
  } else if (state.integrity?.passed) {
    if (state.dateRisk?.requiresConfirmation && !state.datesConfirmed) {
      DOM.integrityStatus.textContent = `✓ All ${state.integrity.rendered} events fit · confirm source dates to export`;
      DOM.integrityStatus.classList.add("integrity-status--warning");
    } else {
      DOM.integrityStatus.textContent = `✓ All ${state.integrity.rendered} selected events rendered once`;
      DOM.integrityStatus.classList.add("integrity-status--passed");
    }
  } else if (state.integrity?.layoutOverflowPages?.length) {
    const pages = state.integrity.layoutOverflowPages.map((index) => index + 1).join(", ");
    DOM.integrityStatus.textContent = `Layout overflow on page ${pages}; export is disabled`;
    DOM.integrityStatus.classList.add("integrity-status--failed");
  } else {
    DOM.integrityStatus.textContent = `Check failed: ${state.integrity?.rendered || 0} of ${selectedEvents.length} events rendered`;
    DOM.integrityStatus.classList.add("integrity-status--failed");
  }
}

function auditRenderedLayout() {
  return [...DOM.previewGrid.querySelectorAll(".guide-page__events")]
    .filter((list) => list.scrollHeight > list.clientHeight + 1 || list.scrollWidth > list.clientWidth + 1)
    .map((list) => Number(list.closest(".guide-page")?.dataset.pageIndex));
}

async function waitForFonts() {
  if (!document.fonts?.ready) return;
  await Promise.race([
    document.fonts.ready,
    new Promise((resolve) => window.setTimeout(resolve, 3000)),
  ]);
}

async function waitForImages(root) {
  const images = [...root.querySelectorAll("img")];
  await Promise.all(
    images.map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve, reject) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", () => reject(new Error("The Dublin footer artwork did not load.")), {
            once: true,
          });
        });
      }
      if (!image.naturalWidth) throw new Error("The Dublin footer artwork did not load.");
      if (image.decode) await image.decode().catch(() => {});
    }),
  );
}

async function generateGuide() {
  const token = ++state.generationToken;
  const selectedEvents = getSelectedEvents();
  const settings = readSettings();
  DOM.integrityStatus.textContent = selectedEvents.length ? "Measuring event rows…" : "Select one or more days to generate pages.";
  await waitForFonts();
  if (token !== state.generationToken) return;

  state.pages = paginateByRenderedHeight(selectedEvents, settings);
  state.integrity = validatePagination(selectedEvents, state.pages);
  renderPages(settings);
  const overflowingPages = auditRenderedLayout();
  state.integrity.layoutOverflowPages = overflowingPages;
  state.integrity.passed = state.integrity.passed && overflowingPages.length === 0;
  updateSummary(selectedEvents);
  registerDebugSurface();
}

function scheduleGuide() {
  window.clearTimeout(generationTimer);
  state.integrity = null;
  syncExportControls();
  generationTimer = window.setTimeout(generateGuide, 80);
}

async function capturePageCanvas(index, scale = readExportScale()) {
  if (!window.html2canvas) throw new Error("The PNG export library did not load. Check the connection and try again.");
  const source = DOM.previewGrid.querySelector(`.guide-page[data-page-index="${index}"]`);
  if (!source) throw new Error("That preview page is no longer available.");

  await waitForFonts();
  const clone = source.cloneNode(true);
  clone.style.removeProperty("--preview-scale");
  DOM.exportStage.replaceChildren(clone);
  try {
    await waitForFonts();
    await waitForImages(clone);
    const canvas = await window.html2canvas(clone, {
      backgroundColor: DESIGN.colors.background,
      width: DESIGN.pageWidth,
      height: DESIGN.pageHeight,
      scale,
      useCORS: true,
      logging: false,
      windowWidth: DESIGN.pageWidth,
      windowHeight: DESIGN.pageHeight,
    });
    const expectedWidth = DESIGN.pageWidth * scale;
    const expectedHeight = DESIGN.pageHeight * scale;
    if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
      throw new Error(`Export was ${canvas.width} × ${canvas.height}px instead of ${expectedWidth} × ${expectedHeight}px.`);
    }
    return canvas;
  } finally {
    DOM.exportStage.replaceChildren();
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode this PNG."));
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setExporting(exporting) {
  state.exporting = exporting;
  document.body.classList.toggle("is-exporting", exporting);
  syncExportControls();
}

function exportBlockMessage() {
  if (!state.pages.length || !state.integrity?.passed) return "Generate a valid guide before exporting.";
  if (state.dateRisk?.requiresConfirmation && !state.datesConfirmed) {
    return `Confirm the ${state.dateRisk.label} source dates before exporting.`;
  }
  return "";
}

async function exportSinglePage(index) {
  if (state.exporting) return;
  const blocked = exportBlockMessage();
  if (blocked) {
    DOM.exportStatus.textContent = blocked;
    return;
  }
  const page = state.pages[index];
  if (!page) return;
  const scale = readExportScale();
  const filename = filenameAtScale(page.filename, scale);
  setExporting(true);
  try {
    DOM.exportStatus.textContent = `Preparing ${filename}…`;
    const canvas = await capturePageCanvas(index, scale);
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, filename);
    DOM.exportStatus.textContent = `${filename} exported at ${canvas.width} × ${canvas.height}px.`;
  } catch (error) {
    DOM.exportStatus.textContent = error.message;
  } finally {
    setExporting(false);
  }
}

async function exportAllPages() {
  if (state.exporting) return;
  const blocked = exportBlockMessage();
  if (blocked) {
    DOM.exportStatus.textContent = blocked;
    return;
  }
  if (!window.JSZip) {
    DOM.exportStatus.textContent = "The ZIP library did not load. Check the connection and try again.";
    return;
  }

  setExporting(true);
  const scale = readExportScale();
  try {
    const zip = new window.JSZip();
    for (let index = 0; index < state.pages.length; index += 1) {
      const page = state.pages[index];
      const filename = filenameAtScale(page.filename, scale);
      DOM.exportStatus.textContent = `Rendering ${index + 1} of ${state.pages.length}: ${filename}`;
      const canvas = await capturePageCanvas(index, scale);
      const blob = await canvasToBlob(canvas);
      zip.file(filename, blob, { binary: true, compression: "STORE" });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    DOM.exportStatus.textContent = "Packing ZIP…";
    const blob = await zip.generateAsync(
      { type: "blob", compression: "STORE" },
      (metadata) => {
        DOM.exportStatus.textContent = `Packing ZIP… ${Math.round(metadata.percent)}%`;
      },
    );
    downloadBlob(blob, scale === 2 ? "alternative-dublin-event-guide-2x.zip" : "alternative-dublin-event-guide.zip");
    DOM.exportStatus.textContent = `${state.pages.length} PNGs exported at ${DESIGN.pageWidth * scale} × ${DESIGN.pageHeight * scale}px.`;
  } catch (error) {
    DOM.exportStatus.textContent = error.message;
  } finally {
    setExporting(false);
  }
}

function renderLoadError(error) {
  state.loading = false;
  setSourceState("error", "Needs CSV", `The Sheet could not be loaded automatically: ${error.message}`);
  DOM.csvFallback.open = true;
  DOM.dataInspector.hidden = !state.dataset;
  DOM.loadSheet.disabled = false;
  DOM.refreshSheet.disabled = false;
  DOM.sheetGid.disabled = false;
  syncExportControls();
}

async function loadGoogleSheet() {
  let gid;
  try {
    gid = parseSheetGid(DOM.sheetGid.value);
  } catch (error) {
    setSourceState("error", "Check tab", error.message);
    DOM.sheetGid.focus();
    return;
  }

  const loadToken = ++state.loadToken;
  state.loading = true;
  DOM.loadSheet.disabled = true;
  DOM.refreshSheet.disabled = true;
  DOM.sheetGid.disabled = true;
  DOM.sheetGid.value = gid;
  setSourceState("loading", "Connecting", `Reading Google Sheet tab ${gid}…`);

  try {
    let table;
    let transport = "GViz";
    try {
      // JSONP is a public Google GViz endpoint that works from a static Pages origin.
      // It also retains the year hidden by the Sheet's mm/dd display format.
      table = await loadSheetViaGviz(gid);
    } catch (gvizError) {
      transport = "CSV";
      try {
        table = await loadSheetViaCsv(gid);
      } catch (csvError) {
        throw new Error(`${gvizError.message} CSV fallback also failed (${csvError.message}).`);
      }
    }

    if (loadToken !== state.loadToken) return;
    state.sheetGid = gid;
    saveSheetGid(gid);
    setDataset(normalizeRows(table), {
      badge: "Sheet connected",
      message: `Loaded tab ${gid} anonymously through Google ${transport}. No sign-in required.`,
      source: `Google Sheet tab ${gid} · ${transport}`,
    });
  } catch (error) {
    if (loadToken !== state.loadToken) return;
    renderLoadError(error);
  }
}

function setDataset(dataset, source) {
  state.loading = false;
  state.dataset = dataset;
  state.events = dataset.events;
  state.source = source.source;
  state.pages = [];
  state.integrity = null;
  state.refreshedAt = new Date();
  state.dateRisk = null;
  state.datesConfirmed = false;
  DOM.confirmDates.checked = false;
  state.selectedDates = new Set(groupEventsByDay(dataset.events).map((group) => group.key));
  DOM.loadSheet.disabled = false;
  DOM.refreshSheet.disabled = false;
  DOM.sheetGid.disabled = false;
  const refreshLabel = source.source.startsWith("Google Sheet") ? "Sheet refreshed" : "CSV loaded";
  setSourceState("success", source.badge, `${source.message} ${refreshLabel} ${formatRefreshTime(state.refreshedAt)}.`);
  renderInspector();
  renderDayFilters();
  renderDateCheck();
  syncExportControls();
  scheduleGuide();
}

function loadCsvText(text, label) {
  try {
    const normalized = normalizeRows(rowsFromCsv(text));
    setDataset(normalized, {
      badge: "CSV loaded",
      message: `Using ${label}. Changes remain in this browser session only.`,
      source: label,
    });
    DOM.csvFallback.open = false;
  } catch (error) {
    setSourceState("error", "CSV error", error.message);
    DOM.csvFallback.open = true;
  }
}

function bindControls() {
  DOM.loadSheet.addEventListener("click", loadGoogleSheet);
  DOM.refreshSheet.addEventListener("click", loadGoogleSheet);
  DOM.generateGuide.addEventListener("click", generateGuide);
  DOM.exportAll.addEventListener("click", exportAllPages);
  DOM.sheetGid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    loadGoogleSheet();
  });

  DOM.csvFile.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    loadCsvText(await file.text(), file.name);
    event.target.value = "";
  });

  DOM.loadPastedCsv.addEventListener("click", () => {
    const text = DOM.csvPaste.value.trim();
    if (!text) {
      setSourceState("error", "CSV empty", "Paste CSV data before loading it.");
      return;
    }
    loadCsvText(text, "pasted CSV");
  });

  document.querySelectorAll('input[name="page-mode"]').forEach((input) => {
    input.addEventListener("change", () => {
      DOM.manualLimitField.hidden = readSettings().mode !== "manual";
      scheduleGuide();
    });
  });
  DOM.manualLimit.addEventListener("input", scheduleGuide);
  DOM.showVenue.addEventListener("change", scheduleGuide);
  DOM.showInstagram.addEventListener("change", scheduleGuide);
  DOM.confirmDates.addEventListener("change", () => {
    state.datesConfirmed = DOM.confirmDates.checked;
    updateSummary(getSelectedEvents());
  });
  document.querySelectorAll('input[name="export-scale"]').forEach((input) => {
    input.addEventListener("change", syncExportControls);
  });

  DOM.selectAllDays.addEventListener("click", () => {
    state.selectedDates = new Set(groupEventsByDay(state.events).map((group) => group.key));
    renderDayFilters();
    scheduleGuide();
  });
  DOM.selectNoDays.addEventListener("click", () => {
    state.selectedDates.clear();
    renderDayFilters();
    scheduleGuide();
  });
}

function getGuideStatus() {
  const exportScale = readExportScale();
  return {
    source: state.source,
    sheetGid: state.sheetGid,
    rowsFound: state.dataset?.rowsFound || 0,
    validEvents: state.events.length,
    ignoredRows: state.dataset?.ignored.length || 0,
    selectedEvents: getSelectedEvents().length,
    pages: state.pages.length,
    pageSizes: state.pages.map((page) => page.events.length),
    filenames: state.pages.map((page) => filenameAtScale(page.filename, exportScale)),
    exportScale,
    outputDimensions: {
      width: DESIGN.pageWidth * exportScale,
      height: DESIGN.pageHeight * exportScale,
    },
    refreshedAt: state.refreshedAt?.toISOString() || null,
    dateRange: state.dateRisk?.label || "",
    dateConfirmationRequired: Boolean(state.dateRisk?.requiresConfirmation),
    datesConfirmed: state.datesConfirmed,
    integrity: state.integrity,
  };
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();

  const register = (tool) => {
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
    } catch {
      // WebMCP is optional; the visible interface remains the source of truth.
    }
  };

  register({
    name: "read_event_guide_status",
    title: "Read event guide status",
    description: "Read the current source counts, page count, filenames, and pagination integrity result.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() {
      return getGuideStatus();
    },
  });

  register({
    name: "configure_event_guide",
    title: "Configure event guide",
    description: "Choose date keys and visible event details, then regenerate the same guide shown in the interface.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "array", items: { type: "string" }, uniqueItems: true },
        pageMode: { type: "string", enum: ["auto", "manual"] },
        maxEvents: { type: "integer", minimum: 1, maximum: 30 },
        showVenue: { type: "boolean" },
        showInstagram: { type: "boolean" },
        exportScale: { type: "integer", enum: [1, 2] },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input = {}) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Configuration must be an object.");
      const availableDays = new Set(groupEventsByDay(state.events).map((group) => group.key));
      if (input.days !== undefined) {
        if (!Array.isArray(input.days) || input.days.some((day) => !availableDays.has(day))) {
          throw new Error("Every day must be an available ISO date key.");
        }
        state.selectedDates = new Set(input.days);
        renderDayFilters();
      }
      if (input.pageMode !== undefined) {
        if (!["auto", "manual"].includes(input.pageMode)) throw new Error("pageMode must be auto or manual.");
        document.querySelector(`input[name="page-mode"][value="${input.pageMode}"]`).checked = true;
        DOM.manualLimitField.hidden = input.pageMode !== "manual";
      }
      if (input.maxEvents !== undefined) {
        if (!Number.isInteger(input.maxEvents) || input.maxEvents < 1 || input.maxEvents > 30) {
          throw new Error("maxEvents must be an integer from 1 to 30.");
        }
        DOM.manualLimit.value = input.maxEvents;
      }
      if (input.showVenue !== undefined) DOM.showVenue.checked = Boolean(input.showVenue);
      if (input.showInstagram !== undefined) DOM.showInstagram.checked = Boolean(input.showInstagram);
      if (input.exportScale !== undefined) {
        if (![1, 2].includes(input.exportScale)) throw new Error("exportScale must be 1 or 2.");
        document.querySelector(`input[name="export-scale"][value="${input.exportScale}"]`).checked = true;
      }
      await generateGuide();
      return getGuideStatus();
    },
  });

  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}

function registerDebugSurface() {
  window.EventGuideDebug = {
    dimensions: { width: DESIGN.pageWidth, height: DESIGN.pageHeight },
    getState: getGuideStatus,
    async verifyFirstExport(scale = readExportScale()) {
      if (![1, 2].includes(scale)) throw new Error("Scale must be 1 or 2.");
      const canvas = await capturePageCanvas(0, scale);
      return { width: canvas.width, height: canvas.height };
    },
  };
}

async function initialize() {
  state.sheetGid = restoreSheetGid();
  DOM.sheetGid.value = state.sheetGid;
  bindControls();
  registerDebugSurface();
  registerWebMcpTools();
  await loadGoogleSheet();
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (state.events.length) scheduleGuide();
    });
  }
}

initialize();
