/**
 * ============================================================================
 * AFTER HOURS EVALUATOR - Single Source of Truth (Deterministic)
 * ============================================================================
 *
 * This module is the ONLY place that decides "is it after hours?".
 * Both:
 * - `services/AfterHoursCallTurnHandler.js`
 * - `services/DynamicFlowEngine.js` (trigger: after_hours)
 * must delegate here to prevent drift.
 *
 * Multi-tenant safety:
 * - Reads ONLY the passed `company` object (already scoped by companyId).
 * - No global state, no caching, no writes.
 *
 * IMPORTANT:
 * If business hours are not configured in a structured way, we return
 * `isAfterHours: false` with reason `no_hours_configured` (never guess).
 */

const DEFAULT_TIMEZONE = 'America/New_York';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function safeTz(company, triggerConfig, businessHours) {
  return (
    triggerConfig?.timezone ||
    businessHours?.timezone ||
    company?.timezone ||
    DEFAULT_TIMEZONE
  );
}

function getLocalParts(now, timeZone) {
  // Deterministic local day + time using built-in Intl (no external deps)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(now);
  const weekdayRaw = parts.find(p => p.type === 'weekday')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '1970';
  const month = parts.find(p => p.type === 'month')?.value || '01';
  const day = parts.find(p => p.type === 'day')?.value || '01';
  const hour = Number(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = Number(parts.find(p => p.type === 'minute')?.value || '0');
  const weekday = weekdayRaw.toLowerCase().slice(0, 3); // mon/tue/...
  const localDate = `${year}-${month}-${day}`; // YYYY-MM-DD in that timezone
  return { weekday, minutes: (hour * 60) + minute, hour, minute, localDate };
}

function parseTimeToMinutes(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return (h * 60) + min;
}

function expandDayRange(key) {
  // Supports: "mon-fri", "sat-sun", "mon", etc.
  const raw = String(key || '').toLowerCase().trim();
  if (!raw) return [];
  if (!raw.includes('-')) return [raw.slice(0, 3)];
  const [a, b] = raw.split('-').map(x => x.trim().slice(0, 3));
  const ai = DAY_KEYS.indexOf(a);
  const bi = DAY_KEYS.indexOf(b);
  if (ai < 0 || bi < 0) return [];
  const out = [];
  // handle wraparound (sat-mon)
  let i = ai;
  while (true) {
    out.push(DAY_KEYS[i]);
    if (i === bi) break;
    i = (i + 1) % DAY_KEYS.length;
  }
  return out;
}

function normalizeHoursConfig(hoursObj) {
  // Supports TWO structured formats:
  //
  // (A) Canonical company config (preferred):
  // {
  //   weekly: { mon:{open:"08:00",close:"17:00"}, tue:..., sat:null, sun:null },
  // }
  //
  // (B) Legacy structured object:
  // { "mon-fri": "08:00-18:00", "sat": "09:00-13:00", "sun": "closed" }
  //
  if (!hoursObj || typeof hoursObj !== 'object') return null;
  const windowsByDay = new Map();

  // Format A
  if (hoursObj.weekly && typeof hoursObj.weekly === 'object') {
    for (const d of DAY_KEYS) {
      const dayVal = hoursObj.weekly[d];
      if (!dayVal) {
        windowsByDay.set(d, []);
        continue;
      }
      const start = parseTimeToMinutes(dayVal.open);
      const end = parseTimeToMinutes(dayVal.close);
      if (start == null || end == null || end <= start) {
        return null;
      }
      windowsByDay.set(d, [{ start, end }]);
    }
    return windowsByDay;
  }

  // Format B
  for (const [k, v] of Object.entries(hoursObj)) {
    const days = expandDayRange(k);
    if (days.length === 0) continue;

    const val = String(v || '').trim().toLowerCase();
    if (!val || val === 'closed') {
      for (const d of days) windowsByDay.set(d, []);
      continue;
    }

    // Allow multiple windows separated by comma: "08:00-12:00, 13:00-17:00"
    const segments = val.split(',').map(s => s.trim()).filter(Boolean);
    const windows = [];
    for (const seg of segments) {
      const mm = seg.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
      if (!mm) continue;
      const start = parseTimeToMinutes(mm[1]);
      const end = parseTimeToMinutes(mm[2]);
      if (start == null || end == null) continue;
      // If end <= start, treat as invalid (no overnight windows for now)
      if (end <= start) continue;
      windows.push({ start, end });
    }
    for (const d of days) windowsByDay.set(d, windows);
  }

  for (const d of DAY_KEYS) {
    if (!windowsByDay.has(d)) windowsByDay.set(d, []);
  }
  return windowsByDay;
}

function resolveCompanyHours(company) {
  // Canonical field: company.aiAgentSettings.businessHours
  const bh = company?.aiAgentSettings?.businessHours;
  if (bh && typeof bh === 'object' && Object.keys(bh).length > 0) {
    return bh;
  }

  // Back-compat (legacy structured object): company.personnel[].hours (if present)
  const personnel = Array.isArray(company?.personnel) ? company.personnel : [];
  for (const p of personnel) {
    if (p?.hours && typeof p.hours === 'object' && Object.keys(p.hours).length > 0) {
      return p.hours;
    }
  }
  return null;
}

/**
 * @returns {{isAfterHours:boolean, reason:string, meta:object}}
 */
function evaluateAfterHours({ company, now = new Date(), triggerConfig = {} }) {
  const useCompanyHours = triggerConfig?.useCompanyHours !== false;
  const hoursObj = useCompanyHours ? resolveCompanyHours(company) : (triggerConfig?.hours || null);
  const timeZone = safeTz(company, triggerConfig, (hoursObj && typeof hoursObj === 'object') ? hoursObj : null);
  const { weekday, minutes, localDate } = getLocalParts(now, timeZone);

  if (!hoursObj) {
    return {
      isAfterHours: false,
      reason: 'no_hours_configured',
      meta: { timeZone, weekday, minutes, localDate, useCompanyHours }
    };
  }

  // Holidays (canonical businessHours.holidays: ["YYYY-MM-DD"])
  const holidays = Array.isArray(hoursObj?.holidays) ? hoursObj.holidays : [];
  if (holidays.includes(localDate)) {
    return {
      isAfterHours: true,
      reason: 'holiday_closed',
      meta: { timeZone, weekday, minutes, localDate, holidaysCount: holidays.length, useCompanyHours }
    };
  }

  const windowsByDay = normalizeHoursConfig(hoursObj);
  if (!windowsByDay) {
    return {
      isAfterHours: false,
      reason: 'hours_invalid_format',
      meta: { timeZone, weekday, minutes, localDate, useCompanyHours }
    };
  }

  const windows = windowsByDay.get(weekday) || [];
  if (!windows.length) {
    return {
      isAfterHours: true,
      reason: 'closed_today',
      meta: { timeZone, weekday, minutes, localDate, windows, useCompanyHours }
    };
  }

  const isOpen = windows.some(w => minutes >= w.start && minutes < w.end);
  return {
    isAfterHours: !isOpen,
    reason: isOpen ? 'ok' : 'outside_window',
    meta: { timeZone, weekday, minutes, localDate, windows, useCompanyHours }
  };
}

module.exports = {
  evaluateAfterHours
};


