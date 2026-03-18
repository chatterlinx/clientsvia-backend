'use strict';

/**
 * ============================================================================
 * HolidayService — Holiday catalog, date computation, closure checks
 * ClientsVia Backend
 *
 * Design principles:
 *  • Dates are NEVER stored in MongoDB — computed at runtime from a key + year
 *  • Covers US federal, religious/cultural, and common observed holidays
 *  • Each company controls per-holiday: closeRegular and closeEmergency
 *  • Supports any year automatically (no annual maintenance needed)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL HOLIDAY CATALOG
// Groups: federal | religious | observance
// defaults apply when a company hasn't yet saved a preference for that holiday
// ─────────────────────────────────────────────────────────────────────────────
const HOLIDAY_CATALOG = [
  // ── Federal ──────────────────────────────────────────────────────────────
  { key: 'new_years_day',    name: "New Year's Day",             group: 'federal',    defaultCloseRegular: true,  defaultCloseEmergency: false },
  { key: 'mlk_day',          name: 'Martin Luther King Jr. Day', group: 'federal',    defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'presidents_day',   name: "Presidents' Day",            group: 'federal',    defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'memorial_day',     name: 'Memorial Day',               group: 'federal',    defaultCloseRegular: true,  defaultCloseEmergency: false },
  { key: 'juneteenth',       name: 'Juneteenth',                 group: 'federal',    defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'independence_day', name: 'Independence Day',           group: 'federal',    defaultCloseRegular: true,  defaultCloseEmergency: false },
  { key: 'labor_day',        name: 'Labor Day',                  group: 'federal',    defaultCloseRegular: true,  defaultCloseEmergency: false },
  { key: 'columbus_day',     name: 'Columbus / Indigenous Day',  group: 'federal',    defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'veterans_day',     name: "Veterans Day",               group: 'federal',    defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'thanksgiving',     name: 'Thanksgiving',               group: 'federal',    defaultCloseRegular: true,  defaultCloseEmergency: true  },
  { key: 'christmas',        name: 'Christmas Day',              group: 'federal',    defaultCloseRegular: true,  defaultCloseEmergency: false },

  // ── Religious / Cultural ─────────────────────────────────────────────────
  { key: 'good_friday',      name: 'Good Friday',                group: 'religious',  defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'easter',           name: 'Easter Sunday',              group: 'religious',  defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'christmas_eve',    name: 'Christmas Eve',              group: 'religious',  defaultCloseRegular: false, defaultCloseEmergency: false },

  // ── Observance ───────────────────────────────────────────────────────────
  { key: 'mothers_day',      name: "Mother's Day",               group: 'observance', defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'fathers_day',      name: "Father's Day",               group: 'observance', defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'halloween',        name: 'Halloween',                  group: 'observance', defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'black_friday',     name: 'Black Friday',               group: 'observance', defaultCloseRegular: false, defaultCloseEmergency: false },
  { key: 'new_years_eve',    name: "New Year's Eve",             group: 'observance', defaultCloseRegular: false, defaultCloseEmergency: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// DATE COMPUTATION — pure functions, no external dependencies
// ─────────────────────────────────────────────────────────────────────────────

/** Nth occurrence of a weekday in a month. weekday 0=Sun…6=Sat, month 1-based. */
function nthWeekday(year, month, weekday, n) {
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) { if (++count === n) return new Date(d); }
    d.setDate(d.getDate() + 1);
  }
}

/** Last occurrence of a weekday in a month. */
function lastWeekday(year, month, weekday) {
  const d = new Date(year, month, 0); // last day of month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return new Date(d);
}

/** Anonymous Gregorian algorithm for Easter Sunday. */
function easterDate(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Compute the actual calendar date for a holiday key and year.
 * Returns a Date (midnight local time) or null if key is unrecognised.
 */
function computeDate(key, year) {
  switch (key) {
    // Fixed-date holidays
    case 'new_years_day':    return new Date(year, 0,  1);
    case 'juneteenth':       return new Date(year, 5, 19);
    case 'independence_day': return new Date(year, 6,  4);
    case 'veterans_day':     return new Date(year, 10, 11);
    case 'halloween':        return new Date(year, 9, 31);
    case 'christmas_eve':    return new Date(year, 11, 24);
    case 'christmas':        return new Date(year, 11, 25);
    case 'new_years_eve':    return new Date(year, 11, 31);

    // Nth-weekday formulas
    case 'mlk_day':        return nthWeekday(year, 1,  1, 3);  // 3rd Mon Jan
    case 'presidents_day': return nthWeekday(year, 2,  1, 3);  // 3rd Mon Feb
    case 'memorial_day':   return lastWeekday(year, 5, 1);      // Last Mon May
    case 'mothers_day':    return nthWeekday(year, 5,  0, 2);  // 2nd Sun May
    case 'fathers_day':    return nthWeekday(year, 6,  0, 3);  // 3rd Sun Jun
    case 'labor_day':      return nthWeekday(year, 9,  1, 1);  // 1st Mon Sep
    case 'columbus_day':   return nthWeekday(year, 10, 1, 2);  // 2nd Mon Oct
    case 'thanksgiving':   return nthWeekday(year, 11, 4, 4);  // 4th Thu Nov
    case 'black_friday': {
      const thx = nthWeekday(year, 11, 4, 4);
      return new Date(thx.getTime() + 86_400_000);              // day after Thanksgiving
    }

    // Easter-derived
    case 'easter':      return easterDate(year);
    case 'good_friday': return new Date(easterDate(year).getTime() - 2 * 86_400_000);

    default: return null;
  }
}

/** Format a Date as "Nov 27" for admin UI display. */
function fmtDate(date) {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the full catalog for a given year with computed dates.
 * Used by the admin UI to render the holiday table.
 *
 * @param {number} [year]
 * @returns {Array<{ key, name, group, date, dateDisplay, defaultCloseRegular, defaultCloseEmergency }>}
 */
function getCatalogForYear(year = new Date().getFullYear()) {
  return HOLIDAY_CATALOG.map(h => {
    const date = computeDate(h.key, year);
    return { ...h, date, dateDisplay: fmtDate(date) };
  });
}

/**
 * Merge company holiday preferences with catalog defaults.
 * Returns every holiday with resolved closeRegular / closeEmergency values.
 *
 * @param {Array}  companyHolidays  — from bookingConfig.holidays in MongoDB
 * @param {number} [year]
 * @returns {Array<{ key, name, group, dateDisplay, closeRegular, closeEmergency }>}
 */
function mergeWithCompanyPrefs(companyHolidays = [], year = new Date().getFullYear()) {
  const prefMap = Object.fromEntries((companyHolidays || []).map(h => [h.key, h]));
  return HOLIDAY_CATALOG.map(h => {
    const pref = prefMap[h.key];
    const date = computeDate(h.key, year);
    return {
      key:            h.key,
      name:           h.name,
      group:          h.group,
      dateDisplay:    fmtDate(date),
      closeRegular:   pref ? !!pref.closeRegular   : h.defaultCloseRegular,
      closeEmergency: pref ? !!pref.closeEmergency : h.defaultCloseEmergency,
    };
  });
}

/**
 * Check whether a given date is a closed holiday for a given service mode.
 *
 * @param {Date}                date
 * @param {Array}               companyHolidays   — from MongoDB bookingConfig.holidays
 * @param {'regular'|'emergency'} serviceMode
 * @returns {{ closed: boolean, holidayName: string|null }}
 */
function checkHolidayClosure(date, companyHolidays = [], serviceMode = 'regular') {
  const year  = date.getFullYear();
  const month = date.getMonth();
  const day   = date.getDate();
  const prefMap = Object.fromEntries((companyHolidays || []).map(h => [h.key, h]));

  for (const h of HOLIDAY_CATALOG) {
    const hDate = computeDate(h.key, year);
    if (!hDate || hDate.getMonth() !== month || hDate.getDate() !== day) continue;

    const pref = prefMap[h.key];
    const closed = serviceMode === 'emergency'
      ? (pref ? !!pref.closeEmergency : h.defaultCloseEmergency)
      : (pref ? !!pref.closeRegular   : h.defaultCloseRegular);

    if (closed) return { closed: true, holidayName: h.name };
  }
  return { closed: false, holidayName: null };
}

/**
 * Walk forward from a given date to find the next day that is NOT a closed holiday.
 * Useful when today is closed — find the soonest open day.
 *
 * @param {Date}    fromDate
 * @param {Array}   companyHolidays
 * @param {'regular'|'emergency'} serviceMode
 * @param {number}  [maxDaysAhead=30]
 * @returns {Date}  First open date (could be fromDate itself)
 */
function nextOpenDate(fromDate, companyHolidays, serviceMode, maxDaysAhead = 30) {
  const d = new Date(fromDate);
  for (let i = 0; i < maxDaysAhead; i++) {
    const { closed } = checkHolidayClosure(d, companyHolidays, serviceMode);
    if (!closed) return new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return new Date(fromDate); // fallback — return original if no open day found
}

module.exports = {
  HOLIDAY_CATALOG,
  getCatalogForYear,
  mergeWithCompanyPrefs,
  checkHolidayClosure,
  nextOpenDate,
  computeDate,           // exposed for tests
};
