/**
 * On-device extraction: amount, currency, date. Anonymize: strip numbers, keep vendor-like tokens.
 * Supports Arabic numerals (٠١٢٣٤٥٦٧٨٩) and bulk unformatted paste.
 */

export type ParsedSms = {
  amount: number;
  currency: string;
  date: string;
  time: string;
  anonymized_text: string;
};

/** Arabic (U+0660–U+0669) and Arabic-Indic (U+06F0–U+06F9) to ASCII digits */
const ARABIC_NUMERALS = /[\u0660-\u0669\u06F0-\u06F9]/g;

function normalizeArabicNumerals(s: string): string {
  return s.replace(ARABIC_NUMERALS, (d) => {
    const code = d.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return d;
  });
}

/** Amount regex: digits (Western or already normalized), optional decimals, optional currency suffix */
const AMOUNT_REGEX = /(\d+(?:\.\d+)?)\s*(?:EGP|ج\.م|ج\.م\.|USD|ج)?/;
const CURRENCY_REGEX = /(EGP|USD|ج\.م)/i;

/** Words that look like a vendor: contain . or / (e.g. APPLE.COM/BILL) or are ALL CAPS */
function isVendorLike(word: string): boolean {
  if (word.length < 2) return false;
  if (/[./]/.test(word)) return true;
  if (word === word.toUpperCase() && /[A-Z]/.test(word)) return true;
  return false;
}

/** Build anonymized hint: strip numbers, prioritize vendor-like tokens (APPLE.COM/BILL), then context words */
function buildAnonymizedVendorHint(text: string): string {
  const normalized = normalizeArabicNumerals(text)
    .replace(/\d+/g, ' ')
    .replace(/[\d.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized.split(' ').filter((w) => w.length > 1);
  const vendorWords: string[] = [];
  const otherWords: string[] = [];
  for (const w of words) {
    if (isVendorLike(w)) vendorWords.push(w);
    else otherWords.push(w);
  }
  const combined = [...vendorWords, ...otherWords.slice(0, 8)].join(' ');
  return combined || 'Unknown';
}

/**
 * Parse a single SMS blob into amount, currency, date, time, anonymized_text.
 * Handles Arabic numerals (e.g. ٥٠ ج.م → 50 EGP).
 */
export function parseSmsText(text: string): ParsedSms | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const normalizedForAmount = normalizeArabicNumerals(trimmed);
  const amountMatch = normalizedForAmount.match(AMOUNT_REGEX);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : NaN;
  if (Number.isNaN(amount)) return null;

  const currencyMatch = trimmed.match(CURRENCY_REGEX);
  let currency = (currencyMatch?.[1] ?? 'EGP').toUpperCase();
  if (currency.includes('ج')) currency = 'EGP';

  const { dateStr, timeStr } = extractDateAndTime(trimmed);

  const anonymized = buildAnonymizedVendorHint(trimmed);

  return {
    amount,
    currency,
    date: dateStr,
    time: timeStr,
    anonymized_text: anonymized,
  };
}

/** Try to extract date/time from start of message; otherwise use today */
function extractDateAndTime(text: string): { dateStr: string; timeStr: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // ISO date at start: 2025-03-10 or 2025-03-10 12:30
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (iso) {
    const dateStr = `${iso[1]}-${iso[2]}-${iso[3]}`;
    const t = iso[4] != null && iso[5] != null
      ? `${iso[4].padStart(2, '0')}:${iso[5].padStart(2, '0')}`
      : timeStr;
    return { dateStr, timeStr: t };
  }

  // DD/MM/YYYY or DD-MM-YYYY at start
  const dmy = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const dateStr = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    const t = dmy[4] != null && dmy[5] != null
      ? `${dmy[4].padStart(2, '0')}:${dmy[5].padStart(2, '0')}`
      : timeStr;
    return { dateStr, timeStr: t };
  }

  // Arabic date pattern at start: ١٠/٣/٢٠٢٥ (normalized)
  const norm = normalizeArabicNumerals(text);
  const dmyNorm = norm.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyNorm) {
    const dateStr = `${dmyNorm[3]}-${dmyNorm[2].padStart(2, '0')}-${dmyNorm[1].padStart(2, '0')}`;
    return { dateStr, timeStr };
  }

  // Date anywhere in first 150 chars (e.g. "تم الخصم في 10/3/2025 بمبلغ 50")
  const slice = norm.slice(0, 150);
  const anyDmy = slice.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (anyDmy) {
    const dateStr = `${anyDmy[3]}-${anyDmy[2].padStart(2, '0')}-${anyDmy[1].padStart(2, '0')}`;
    return { dateStr, timeStr };
  }
  const anyIso = slice.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (anyIso) {
    return { dateStr: `${anyIso[1]}-${anyIso[2]}-${anyIso[3]}`, timeStr };
  }

  return { dateStr: today, timeStr };
}

export type BulkMessage = { raw: string; parsed: ParsedSms };

/** Normalize line endings so \r\n and \r become \n */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Split pasted text into individual messages and parse each.
 * - Normalizes \r\n and \r to \n; treats \u2029 (paragraph) and \u2028 (line) as separators.
 * - Splits by blank lines (\n\s*\n) first.
 * - If the whole paste is one block with multiple lines (e.g. "msg1\nmsg2\nmsg3"), splits by single newline so each line is a message.
 * - Otherwise per block: parse whole block first; if that fails, try each line; then try amount-pattern split.
 */
export function splitBulkSmsText(pasted: string): BulkMessage[] {
  const normalized = normalizeLineEndings(pasted.trim());
  if (!normalized) return [];

  const results: BulkMessage[] = [];

  // Split by blank lines or Unicode paragraph/line separator
  let blocks = normalized
    .split(/\n\s*\n|\u2029|\u2028+/)
    .map((b) => b.trim())
    .filter(Boolean);

  // If paste has no blank lines (one block) but multiple lines, treat each line as a message
  if (blocks.length === 1 && blocks[0].includes('\n')) {
    const lines = blocks[0].split(/\n/).map((l) => l.trim()).filter(Boolean);
    const lineResults: BulkMessage[] = [];
    for (const line of lines) {
      const p = parseSmsText(line);
      if (p) lineResults.push({ raw: line, parsed: p });
    }
    if (lineResults.length > 1) return lineResults;
  }

  for (const block of blocks) {
    const parsed = parseSmsText(block);
    if (parsed) {
      results.push({ raw: block, parsed });
      continue;
    }
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      for (const line of lines) {
        const p = parseSmsText(line);
        if (p) results.push({ raw: line, parsed: p });
      }
      continue;
    }
    const single = block;
    const norm = normalizeArabicNumerals(single);
    const amountPattern = /\d+(?:\.\d+)?\s*(?:EGP|ج\.م|ج\.م\.|USD|ج)?/g;
    const matches: { index: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = amountPattern.exec(norm)) !== null) matches.push({ index: m.index });
    if (matches.length >= 2) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : single.length;
        const segment = single.slice(start, end).trim();
        const p = parseSmsText(segment);
        if (p) results.push({ raw: segment, parsed: p });
      }
    }
  }

  return results;
}
