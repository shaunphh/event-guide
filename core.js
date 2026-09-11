const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const MONTH_LOOKUP = Object.freeze({
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
});

export function parseCsv(input) {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cellValue) => String(cellValue).trim()));
}

export function rowsFromCsv(csvText) {
  const parsed = parseCsv(csvText);
  if (!parsed.length) throw new Error("The CSV is empty.");
  const [headers, ...rows] = parsed;
  return { headers, rows };
}

export function gvizTableToRows(response) {
  if (!response || response.status !== "ok" || !response.table) {
    const message = response?.errors?.[0]?.detailed_message || "Google returned an unreadable Sheet response.";
    throw new Error(message);
  }

  const columns = response.table.cols || [];
  const headers = columns.map((column) => column.label || column.id || "");
  const rows = (response.table.rows || []).map((row) =>
    columns.map((column, index) => {
      const tableCell = row.c?.[index];
      if (!tableCell || tableCell.v === null || tableCell.v === undefined) return "";
      if (column.type === "date" && /^Date\(/.test(String(tableCell.v))) return String(tableCell.v);
      if (tableCell.f !== null && tableCell.f !== undefined) return String(tableCell.f);
      if (typeof tableCell.v === "boolean") return tableCell.v ? "TRUE" : "FALSE";
      return String(tableCell.v);
    }),
  );
  return { headers, rows };
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function mapHeaders(headers) {
  const normalized = headers.map(normalizeHeader);
  const find = (predicate) => normalized.findIndex((header) => header && predicate(header));
  return {
    date: find((header) => header.startsWith("date") || header === "day"),
    title: find(
      (header) => header === "name" || header === "title" || header === "eventname" || header === "eventtitle",
    ),
    venue: find((header) => header.includes("location") || header === "venue"),
    time: find((header) => header === "time" || header.includes("starttime")),
    url: find(
      (header) =>
        header === "url" ||
        header.includes("ticketslink") ||
        header === "ticketlink" ||
        header === "eventlink",
    ),
    instagram: find((header) => header.includes("instagram") || header === "handle"),
    approved: find((header) => header.includes("approved")),
    topPick: find((header) => header.includes("toppick")),
    comments: find((header) => header === "comments" || header === "comment"),
    whatsNew: find((header) => header.includes("whatsnew")),
  };
}

function cell(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function makeDate(year, month, day) {
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseGoogleDate(value) {
  const match = String(value).match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  return match ? makeDate(Number(match[1]), Number(match[2]) + 1, Number(match[3])) : null;
}

function numericDateParts(value) {
  const match = String(value).trim().match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (!match) return null;
  return {
    month: Number(match[1]),
    day: Number(match[2]),
    year: match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : null,
  };
}

function isoDateParts(value) {
  const match = String(value).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function namedDateParts(value) {
  const match = String(value)
    .trim()
    .match(
      /^(?:(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\s*,?\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/i,
    );
  if (!match) return null;
  const month = MONTH_LOOKUP[match[2].toLowerCase()];
  if (!month) return null;
  return { day: Number(match[1]), month, year: match[3] ? Number(match[3]) : null };
}

function strictDateParts(value) {
  return isoDateParts(value) || numericDateParts(value) || namedDateParts(value);
}

function looksLikeDate(value) {
  return Boolean(parseGoogleDate(value) || strictDateParts(value));
}

function weekdayFromHeader(header) {
  const normalized = String(header ?? "").toLowerCase();
  return WEEKDAYS.findIndex((weekday) => normalized.includes(weekday));
}

function inferYear(firstDateValue, dateContext, now) {
  const googleDate = parseGoogleDate(firstDateValue);
  if (googleDate) return googleDate.getFullYear();
  const parts = strictDateParts(firstDateValue);
  if (!parts) return now.getFullYear();
  if (parts.year) return parts.year;

  const intendedWeekday = weekdayFromHeader(dateContext);
  const currentYear = now.getFullYear();
  const candidates = [];
  for (let year = currentYear - 3; year <= currentYear + 3; year += 1) {
    const date = makeDate(year, parts.month, parts.day);
    if (!date || (intendedWeekday >= 0 && date.getDay() !== intendedWeekday)) continue;
    candidates.push({ year, distance: Math.abs(date.getTime() - now.getTime()) });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.year ?? currentYear;
}

function parseDateValue(value, yearHint) {
  const googleDate = parseGoogleDate(value);
  if (googleDate) return googleDate;
  const parts = strictDateParts(value);
  if (parts) return makeDate(parts.year ?? yearHint, parts.month, parts.day);
  const timestamp = Date.parse(String(value));
  if (Number.isNaN(timestamp)) return null;
  const parsed = new Date(timestamp);
  return makeDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

function inferDateColumn(headers, rows, titleIndex) {
  let bestIndex = -1;
  let bestScore = 0;
  headers.forEach((_, columnIndex) => {
    if (columnIndex === titleIndex) return;
    const score = rows.slice(0, 100).reduce((total, row) => total + (looksLikeDate(cell(row, columnIndex)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestIndex = columnIndex;
      bestScore = score;
    }
  });
  return bestIndex;
}

function isWeekdayLabel(value) {
  return /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s*\(\d+\))?$/i.test(
    String(value ?? "").trim(),
  );
}

function toDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function asBoolean(value) {
  return ["true", "yes", "y", "1", "approved"].includes(String(value).trim().toLowerCase());
}

function normalizeInstagram(value) {
  let handle = String(value ?? "").trim();
  if (!handle) return "";
  if (/^https?:\/\//i.test(handle)) {
    try {
      const url = new URL(handle);
      if (url.hostname.includes("instagram.com")) handle = url.pathname.split("/").filter(Boolean)[0] || "";
    } catch {
      // Preserve malformed source text below.
    }
  }
  handle = handle.replace(/^@+/, "").replace(/\s+/g, "");
  return handle ? `@${handle}` : "";
}

function normalizeTime(value) {
  const time = String(value ?? "").trim();
  return time ? time.replace(/\b(am|pm)\b/gi, (marker) => marker.toUpperCase()) : "TBC";
}

function validHttpUrl(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeRows({ headers, rows }, options = {}) {
  const indices = mapHeaders(headers);
  if (indices.date < 0) indices.date = inferDateColumn(headers, rows, indices.title);
  if (indices.date < 0 || indices.title < 0) {
    throw new Error("The CSV needs a date column (or dated weekday rows) and a name/title column.");
  }

  let firstWeekdaySection = "";
  let sectionDate = "";
  const candidateRows = [];
  rows.forEach((row, index) => {
    if (!row.some((value) => String(value ?? "").trim())) return;
    const dateValue = cell(row, indices.date);
    const titleValue = cell(row, indices.title);
    const otherValues = [
      indices.venue,
      indices.time,
      indices.url,
      indices.instagram,
      indices.approved,
      indices.topPick,
      indices.comments,
      indices.whatsNew,
    ].map((columnIndex) => cell(row, columnIndex));
    const isDatedWeekdaySection = looksLikeDate(dateValue) && isWeekdayLabel(titleValue);
    const isLegacyWeekdaySection =
      isWeekdayLabel(dateValue) && !titleValue && otherValues.every((value) => !value);
    const isWeekdaySection = isDatedWeekdaySection || isLegacyWeekdaySection;
    if (isWeekdaySection) {
      if (looksLikeDate(dateValue)) sectionDate = dateValue;
      if (!firstWeekdaySection) firstWeekdaySection = `${dateValue} ${titleValue}`.trim();
      return;
    }
    candidateRows.push({ row, sourceRow: index + 2, sectionDate });
  });

  const firstDateValue =
    candidateRows.map(({ row, sectionDate: rowSectionDate }) => cell(row, indices.date) || rowSectionDate).find(Boolean) || "";
  const now = options.now instanceof Date ? options.now : new Date();
  const dateContext = `${headers[indices.date] || ""} ${firstWeekdaySection}`;
  let yearCursor = inferYear(firstDateValue, dateContext, now);
  let previousMonth = null;
  let carriedDate = "";
  const events = [];
  const ignored = [];
  const hasApprovalColumn = indices.approved >= 0;

  candidateRows.forEach(({ row, sourceRow, sectionDate: rowSectionDate }) => {
    const enteredDate = cell(row, indices.date);
    const contextualDate = rowSectionDate || "";
    if (enteredDate) carriedDate = enteredDate;
    else if (contextualDate) carriedDate = contextualDate;
    const rawDate = enteredDate || contextualDate || carriedDate;
    const dateParts = strictDateParts(rawDate);
    if ((enteredDate || contextualDate) && dateParts && !dateParts.year) {
      if (previousMonth !== null && dateParts.month < previousMonth - 6) yearCursor += 1;
      if (previousMonth !== null && dateParts.month > previousMonth + 6) yearCursor -= 1;
      previousMonth = dateParts.month;
    }

    const parsedDate = rawDate ? parseDateValue(rawDate, yearCursor) : null;
    const title = cell(row, indices.title);
    const approved = hasApprovalColumn ? asBoolean(cell(row, indices.approved)) : true;
    let reason = "";
    if (!approved) reason = "not approved";
    else if (!rawDate || !parsedDate) reason = "missing or invalid date";
    else if (!title) reason = "missing event name";
    if (reason) {
      ignored.push({ sourceRow, title: title || "Untitled row", reason });
      return;
    }

    const urlRaw = cell(row, indices.url);
    const instagramRaw = cell(row, indices.instagram);
    events.push({
      id: `event-${sourceRow}`,
      sourceRow,
      date: parsedDate,
      dateKey: toDateKey(parsedDate),
      rawDate,
      dateInferred: !enteredDate,
      time: normalizeTime(cell(row, indices.time)),
      title,
      venue: cell(row, indices.venue),
      instagramRaw,
      instagram: normalizeInstagram(instagramRaw),
      urlRaw,
      url: validHttpUrl(urlRaw),
      approved,
      topPick: indices.topPick >= 0 && asBoolean(cell(row, indices.topPick)),
      editorialComment: cell(row, indices.comments),
      whatsNew: cell(row, indices.whatsNew),
    });
  });

  return {
    events,
    ignored,
    rowsFound: candidateRows.length,
    hasApprovalColumn,
    schema: indices,
    headers,
  };
}

export function formatDay(date) {
  return WEEKDAYS[date.getDay()].toUpperCase();
}

export function formatDayShort(date) {
  return WEEKDAYS[date.getDay()].slice(0, 3).replace(/^./, (letter) => letter.toUpperCase());
}

export function formatDateHeading(date) {
  return `${formatDay(date)} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

export function formatFooterDate(date) {
  return `${formatDayShort(date)} ${date.getDate()} ${MONTHS[date.getMonth()].toLowerCase()}`;
}

export function formatBadgeTime(value) {
  const time = String(value ?? "").trim();
  const meridiem = time.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!meridiem) return time || "TBC";
  let hours = Number(meridiem[1]) % 12;
  if (meridiem[3].toUpperCase() === "PM") hours += 12;
  return `${String(hours).padStart(2, "0")}:${meridiem[2] || "00"}`;
}

function formatDateRange(minDate, maxDate) {
  const titleCaseMonth = (month) => month.toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
  const minMonth = titleCaseMonth(MONTHS[minDate.getMonth()]);
  const maxMonth = titleCaseMonth(MONTHS[maxDate.getMonth()]);
  const minDay = minDate.getDate();
  const maxDay = maxDate.getDate();
  const minYear = minDate.getFullYear();
  const maxYear = maxDate.getFullYear();
  if (minDate.getTime() === maxDate.getTime()) return `${minDay} ${minMonth} ${minYear}`;
  if (minYear === maxYear && minDate.getMonth() === maxDate.getMonth()) {
    return `${minDay}–${maxDay} ${maxMonth} ${maxYear}`;
  }
  if (minYear === maxYear) return `${minDay} ${minMonth}–${maxDay} ${maxMonth} ${maxYear}`;
  return `${minDay} ${minMonth} ${minYear}–${maxDay} ${maxMonth} ${maxYear}`;
}

export function assessDateRange(events, now = new Date()) {
  const dates = events
    .map((event) => event?.date)
    .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);
  if (!dates.length) {
    return { requiresConfirmation: false, label: "", reason: "", minDate: null, maxDate: null };
  }

  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const day = 24 * 60 * 60 * 1000;
  const daysFromLatest = Math.round((maxDate.getTime() - today.getTime()) / day);
  const daysToEarliest = Math.round((minDate.getTime() - today.getTime()) / day);
  const spanDays = Math.round((maxDate.getTime() - minDate.getTime()) / day);
  let reason = "";
  if (daysFromLatest < -14) reason = "These dates are more than two weeks in the past.";
  else if (daysToEarliest > 90) reason = "These dates are more than 90 days in the future.";
  else if (spanDays > 31) reason = "The selected dates span more than one month.";

  return {
    requiresConfirmation: Boolean(reason),
    label: formatDateRange(minDate, maxDate),
    reason,
    minDate,
    maxDate,
  };
}

export function groupEventsByDay(events) {
  const groups = [];
  const byKey = new Map();
  events.forEach((event) => {
    if (!byKey.has(event.dateKey)) {
      const group = { key: event.dateKey, date: event.date, events: [] };
      byKey.set(event.dateKey, group);
      groups.push(group);
    }
    byKey.get(event.dateKey).events.push(event);
  });
  return groups;
}

export function validatePagination(events, pages) {
  const expectedIds = events.map((event) => event.id);
  const expectedSet = new Set(expectedIds);
  const renderedIds = pages.flatMap((page) => page.events.map((event) => event.id));
  const counts = new Map();
  renderedIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  const missing = expectedIds.filter((id) => !counts.has(id));
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const unexpected = renderedIds.filter((id) => !expectedSet.has(id));
  return {
    passed:
      renderedIds.length === expectedIds.length &&
      missing.length === 0 &&
      duplicates.length === 0 &&
      unexpected.length === 0,
    expected: expectedIds.length,
    rendered: renderedIds.length,
    missing,
    duplicates,
    unexpected,
  };
}

export function filenameForPage(index, total, day) {
  const digits = Math.max(2, String(total).length);
  const slug = String(day || "page")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${String(index + 1).padStart(digits, "0")}-${slug || "page"}.png`;
}
