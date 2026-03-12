/**
 * Normalize a date string to YYYY-MM-DD for consistent storage and range queries.
 * Handles YYYY-MM-DD, ISO strings, DD/MM/YYYY, MM/DD/YYYY, and other Date-parseable formats.
 * When day/month are ambiguous (e.g. 03/11 or 11/03), optional expectedMonths (1–12)
 * is used: if one of the two numbers is in expectedMonths, treat it as the month.
 */
/** Excel serial date: days since 1900-01-01. JS epoch offset in days = 25569. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86400 * 1000;

function resolveAmbiguousTwoNumbers(
  n1: number,
  n2: number,
  year: number,
  expectedMonths?: number[]
): { month: number; day: number } | null {
  let month: number;
  let day: number;
  if (n1 > 12 && n2 <= 12) {
    day = n1;
    month = n2;
  } else if (n2 > 12 && n1 <= 12) {
    month = n1;
    day = n2;
  } else if (n1 <= 12 && n2 <= 12) {
    const set = expectedMonths && expectedMonths.length > 0 ? new Set(expectedMonths) : null;
    if (set) {
      const in1 = set.has(n1);
      const in2 = set.has(n2);
      if (in1 && !in2) {
        month = n1;
        day = n2;
      } else if (in2 && !in1) {
        month = n2;
        day = n1;
      } else if (in1 && in2) {
        month = Math.min(n1, n2);
        day = Math.max(n1, n2);
      } else {
        month = n1;
        day = n2;
      }
    } else {
      month = n1;
      day = n2;
    }
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const lastDay = new Date(year, month, 0).getDate();
  if (day > lastDay) return null;
  return { month, day };
}

export function normalizeDateToYYYYMMDD(value: unknown, expectedMonths?: number[]): string {
  if (value == null) return '';
  let s = String(value).trim().replace(/,/g, '');
  if (!s) return '';

  const trimmed = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (s.includes('T')) {
    const iso = s.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  }

  const numeric = /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= 100000) {
    const ms = Math.round((numeric - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      if (y >= 1900 && y <= 2100) return `${y}-${m}-${day}`;
    }
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const result = `${y}-${m}-${day}`;
    if (result === '1970-01-01' && /^\d+(\.\d+)?$/.test(s)) {
      const n = parseFloat(s);
      if (n >= 1 && n <= 100000) {
        const ms = Math.round((n - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY);
        const excelDate = new Date(ms);
        if (!Number.isNaN(excelDate.getTime())) {
          const ey = excelDate.getUTCFullYear();
          const em = String(excelDate.getUTCMonth() + 1).padStart(2, '0');
          const ed = String(excelDate.getUTCDate()).padStart(2, '0');
          if (ey >= 1900 && ey <= 2100) return `${ey}-${em}-${ed}`;
        }
      }
    }
    return result;
  }
  const slashOrDashWithYear = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashOrDashWithYear) {
    const [, a, b, y] = slashOrDashWithYear;
    const n1 = parseInt(a!, 10);
    const n2 = parseInt(b!, 10);
    const yearNum = parseInt(y!, 10);
    if (yearNum < 1900 || yearNum > 2100) return '';
    const resolved = resolveAmbiguousTwoNumbers(n1, n2, yearNum, expectedMonths);
    if (!resolved) return '';
    return `${yearNum}-${String(resolved.month).padStart(2, '0')}-${String(resolved.day).padStart(2, '0')}`;
  }

  const currentYear = new Date().getFullYear();
  const slashOrDashNoYear = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (slashOrDashNoYear) {
    const [, a, b] = slashOrDashNoYear;
    const n1 = parseInt(a!, 10);
    const n2 = parseInt(b!, 10);
    const resolved = resolveAmbiguousTwoNumbers(n1, n2, currentYear, expectedMonths);
    if (!resolved) return '';
    return `${currentYear}-${String(resolved.month).padStart(2, '0')}-${String(resolved.day).padStart(2, '0')}`;
  }

  return '';
}
