import {
  filenameForPage,
  formatDateHeading,
  formatDay,
  formatDayShort,
  groupEventsByDay,
  gvizTableToRows,
  normalizeRows,
  rowsFromCsv,
  validatePagination,
} from "./core.js";

// Change the fixed canvas, content area, type scale, and spacing here.
export const DESIGN = Object.freeze({
  pageWidth: 1080,
  pageHeight: 1350,
  paddingX: 86,
  paddingTop: 76,
  paddingBottom: 62,
  headerHeight: 172,
  footerHeight: 106,
  eventGap: 24,
  timeWidth: 154,
  columnGap: 30,
  eventTitleSize: 42,
  eventMetaSize: 24,
  colors: {
    background: "#f3f2ec",
    ink: "#11110f",
    yellow: "#f6cf24",
  },
});

const SHEET = Object.freeze({
  id: "1rXUChbT3TuOI3b7NaXpXudph96BhLCfEneSjcGW6kp4",
  gid: "162101761",
});

const state = {
  dataset: null,
  events: [],
  selectedDates: new Set(),
  pages: [],
  integrity: null,
  source: "",
  loading: false,
  exporting: false,
  generationToken: 0,
  loadToken: 0,
};

const byId = (id) => document.getElementById(id);
const DOM = {
  loadSheet: byId("load-sheet"),
  refreshSheet: byId("refresh-sheet"),
  sourceBadge: byId("source-badge"),
  sourceMessage: byId("source-message"),
  dataInspector: byId("data-inspector"),
  rowsFound: byId("rows-found"),
  eventsValid: byId("events-valid"),
  rowsIgnored: byId("rows-ignored"),
  dayCounts: byId("day-counts"),
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

function applyDesignTokens() {
  const root = document.documentElement.style;
  const pixels = {
    "--guide-width": DESIGN.pageWidth,
    "--guide-height": DESIGN.pageHeight,
    "--guide-padding-x": DESIGN.paddingX,
    "--guide-padding-top": DESIGN.paddingTop,
    "--guide-padding-bottom": DESIGN.paddingBottom,
    "--guide-header-height": DESIGN.headerHeight,
    "--guide-footer-height": DESIGN.footerHeight,
    "--guide-event-gap": DESIGN.eventGap,
    "--guide-time-width": DESIGN.timeWidth,
    "--guide-column-gap": DESIGN.columnGap,
    "--guide-event-title-size": DESIGN.eventTitleSize,
    "--guide-event-meta-size": DESIGN.eventMetaSize,
  };
  Object.entries(pixels).forEach(([token, value]) => root.setProperty(token, `${value}px`));
  root.setProperty("--guide-background", DESIGN.colors.background);
  root.setProperty("--guide-ink", DESIGN.colors.ink);
  root.setProperty("--guide-yellow", DESIGN.colors.yellow);
}

function setSourceState(kind, badge, message) {
  DOM.sourceBadge.className = `status-badge status-badge--${kind}`;
  DOM.sourceBadge.textContent = badge;
  DOM.sourceMessage.textContent = message;
  DOM.sourceMessage.classList.toggle("source-message--error", kind === "error");
}

function loadSheetViaGviz() {
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
    script.src = `https://docs.google.com/spreadsheets/d/${SHEET.id}/gviz/tq?gid=${SHEET.gid}&headers=1&tqx=${encodeURIComponent(tqx)}&t=${Date.now()}`;
    script.onerror = () => finish(new Error("Google's public GViz endpoint was blocked."));
    script.referrerPolicy = "no-referrer";
    document.head.appendChild(script);
  });
}

async function loadSheetViaCsv() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 7000);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET.id}/export?format=csv&gid=${SHEET.gid}&t=${Date.now()}`;
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

  groupEventsByDay(dataset.events).forEach((group) => {
    const item = document.createElement("li");
    const day = document.createElement("span");
    const count = document.createElement("strong");
    day.textContent = `${formatDayShort(group.date)} ${group.date.getDate()}`;
    count.textContent = group.events.length;
    item.append(day, count);
    DOM.dayCounts.appendChild(item);
  });
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

function getSelectedEvents() {
  return state.events.filter((event) => state.selectedDates.has(event.dateKey));
}

function createEventElement(event, settings) {
  const item = document.createElement("article");
  item.className = "guide-event";
  item.dataset.eventId = event.id;

  const time = document.createElement("time");
  time.className = "guide-event__time";
  time.textContent = event.time;

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

  const header = document.createElement("header");
  header.className = "guide-page__header";
  const kicker = document.createElement("div");
  kicker.className = "guide-page__kicker";
  const label = document.createElement("span");
  label.textContent = "Alternative Dublin · Weekly";
  const edition = document.createElement("span");
  edition.className = "guide-page__edition";
  edition.textContent = `${page.dayPage} / ${page.dayPages}`;
  kicker.append(label, edition);
  const day = document.createElement("h2");
  day.className = "guide-page__day";
  day.textContent = formatDateHeading(page.date);
  header.append(kicker, day);

  const list = document.createElement("div");
  list.className = "guide-page__events";
  page.events.forEach((event) => list.appendChild(createEventElement(event, settings)));

  const footer = document.createElement("footer");
  footer.className = "guide-page__footer";
  const footerTitle = document.createElement("div");
  footerTitle.className = "guide-page__footer-title";
  footerTitle.append(document.createTextNode("Dublin "));
  const footerSuffix = document.createElement("span");
  footerSuffix.textContent = "Event Guide";
  footerTitle.appendChild(footerSuffix);
  const pageNumber = document.createElement("div");
  pageNumber.className = "guide-page__page-number";
  const pageLabel = document.createElement("span");
  pageLabel.textContent = "PAGE";
  const pageValue = document.createElement("strong");
  pageValue.textContent = String(page.globalIndex + 1).padStart(2, "0");
  pageNumber.append(pageLabel, pageValue);
  footer.append(footerTitle, pageNumber);
  element.append(header, list, footer);
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
}

function updateSummary(selectedEvents) {
  DOM.selectedEventCount.textContent = selectedEvents.length;
  DOM.pageCount.textContent = state.pages.length;
  DOM.previewPageCount.textContent = state.pages.length ? `${state.pages.length} pages` : "No pages";
  DOM.generateGuide.disabled = !state.events.length;
  DOM.exportAll.disabled = !state.pages.length || !state.integrity?.passed || state.exporting;

  DOM.integrityStatus.className = "integrity-status";
  if (!selectedEvents.length) {
    DOM.integrityStatus.textContent = "Select one or more days to generate pages.";
  } else if (state.integrity?.passed) {
    DOM.integrityStatus.textContent = `✓ All ${state.integrity.rendered} selected events rendered once`;
    DOM.integrityStatus.classList.add("integrity-status--passed");
  } else {
    DOM.integrityStatus.textContent = `Check failed: ${state.integrity?.rendered || 0} of ${selectedEvents.length} events rendered`;
    DOM.integrityStatus.classList.add("integrity-status--failed");
  }
}

async function waitForFonts() {
  if (!document.fonts?.ready) return;
  await Promise.race([
    document.fonts.ready,
    new Promise((resolve) => window.setTimeout(resolve, 3000)),
  ]);
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
  updateSummary(selectedEvents);
  registerDebugSurface();
}

function scheduleGuide() {
  window.clearTimeout(generationTimer);
  generationTimer = window.setTimeout(generateGuide, 80);
}

async function capturePageCanvas(index) {
  if (!window.html2canvas) throw new Error("The PNG export library did not load. Check the connection and try again.");
  const source = DOM.previewGrid.querySelector(`.guide-page[data-page-index="${index}"]`);
  if (!source) throw new Error("That preview page is no longer available.");

  await waitForFonts();
  const clone = source.cloneNode(true);
  clone.style.removeProperty("--preview-scale");
  DOM.exportStage.replaceChildren(clone);
  try {
    const canvas = await window.html2canvas(clone, {
      backgroundColor: DESIGN.colors.background,
      width: DESIGN.pageWidth,
      height: DESIGN.pageHeight,
      scale: 1,
      useCORS: true,
      logging: false,
      windowWidth: DESIGN.pageWidth,
      windowHeight: DESIGN.pageHeight,
    });
    if (canvas.width !== DESIGN.pageWidth || canvas.height !== DESIGN.pageHeight) {
      throw new Error(`Export was ${canvas.width} × ${canvas.height}px instead of ${DESIGN.pageWidth} × ${DESIGN.pageHeight}px.`);
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
  DOM.exportAll.disabled = exporting || !state.pages.length || !state.integrity?.passed;
  DOM.generateGuide.disabled = exporting || !state.events.length;
  document.querySelectorAll(".page-card__toolbar button").forEach((button) => {
    button.disabled = exporting;
  });
}

async function exportSinglePage(index) {
  if (state.exporting) return;
  const page = state.pages[index];
  if (!page) return;
  setExporting(true);
  try {
    DOM.exportStatus.textContent = `Preparing ${page.filename}…`;
    const canvas = await capturePageCanvas(index);
    const blob = await canvasToBlob(canvas);
    downloadBlob(blob, page.filename);
    DOM.exportStatus.textContent = `${page.filename} exported at ${canvas.width} × ${canvas.height}px.`;
  } catch (error) {
    DOM.exportStatus.textContent = error.message;
  } finally {
    setExporting(false);
  }
}

async function exportAllPages() {
  if (!state.pages.length || state.exporting) return;
  if (!window.JSZip) {
    DOM.exportStatus.textContent = "The ZIP library did not load. Check the connection and try again.";
    return;
  }

  setExporting(true);
  try {
    const zip = new window.JSZip();
    for (let index = 0; index < state.pages.length; index += 1) {
      const page = state.pages[index];
      DOM.exportStatus.textContent = `Rendering ${index + 1} of ${state.pages.length}: ${page.filename}`;
      const canvas = await capturePageCanvas(index);
      const blob = await canvasToBlob(canvas);
      zip.file(page.filename, blob, { binary: true, compression: "STORE" });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    DOM.exportStatus.textContent = "Packing ZIP…";
    const blob = await zip.generateAsync(
      { type: "blob", compression: "STORE" },
      (metadata) => {
        DOM.exportStatus.textContent = `Packing ZIP… ${Math.round(metadata.percent)}%`;
      },
    );
    downloadBlob(blob, "alternative-dublin-event-guide.zip");
    DOM.exportStatus.textContent = `${state.pages.length} full-resolution PNGs exported.`;
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
  DOM.dataInspector.hidden = true;
  DOM.loadSheet.disabled = false;
  DOM.refreshSheet.disabled = false;
}

async function loadGoogleSheet() {
  const loadToken = ++state.loadToken;
  state.loading = true;
  DOM.loadSheet.disabled = true;
  DOM.refreshSheet.disabled = true;
  setSourceState("loading", "Connecting", "Reading the public Google Sheet…");

  try {
    let table;
    let transport = "GViz";
    try {
      // JSONP is a public Google GViz endpoint that works from a static Pages origin.
      // It also retains the year hidden by the Sheet's mm/dd display format.
      table = await loadSheetViaGviz();
    } catch (gvizError) {
      transport = "CSV";
      try {
        table = await loadSheetViaCsv();
      } catch (csvError) {
        throw new Error(`${gvizError.message} CSV fallback also failed (${csvError.message}).`);
      }
    }

    if (loadToken !== state.loadToken) return;
    setDataset(normalizeRows(table), {
      badge: "Sheet connected",
      message: `Loaded anonymously through Google ${transport}. No sign-in required.`,
      source: `Google Sheet · ${transport}`,
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
  state.selectedDates = new Set(groupEventsByDay(dataset.events).map((group) => group.key));
  DOM.loadSheet.disabled = false;
  DOM.refreshSheet.disabled = false;
  setSourceState("success", source.badge, source.message);
  renderInspector();
  renderDayFilters();
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
  return {
    source: state.source,
    rowsFound: state.dataset?.rowsFound || 0,
    validEvents: state.events.length,
    ignoredRows: state.dataset?.ignored.length || 0,
    selectedEvents: getSelectedEvents().length,
    pages: state.pages.length,
    pageSizes: state.pages.map((page) => page.events.length),
    filenames: state.pages.map((page) => page.filename),
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
    async verifyFirstExport() {
      const canvas = await capturePageCanvas(0);
      return { width: canvas.width, height: canvas.height };
    },
  };
}

async function initialize() {
  applyDesignTokens();
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
