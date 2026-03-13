/**
 * AI-powered sheet import: extract transactions from pasted sheet (CSV/table)
 * and match them to existing transactions (amount tolerance, date, category similarity).
 */
import { normalizeDateToYYYYMMDD } from '../lib/date';
import type { LearningExample } from './sms-extract';

export interface SheetMergeConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export interface ExtractedSheetRow {
  amount: number;
  currency: string;
  date: string; // YYYY-MM-DD
  category_name: string;
  merchant: string | null;
  /** Exact line(s) from the pasted sheet that produced this row (for display in wizard). */
  raw_line?: string | null;
}

export interface ExistingTransactionForMatch {
  id: string;
  amount: number;
  date: string;
  category_name: string;
  merchant: string | null;
}

export interface SheetMergePreviewItem {
  sheet_index: number;
  amount: number;
  currency: string;
  date: string;
  category_name: string;
  merchant: string | null;
  matched_entry_id: string | null;
  matched_entry: ExistingTransactionForMatch | null;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 120_000;

function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'EGP';
  const letters = value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return letters.length === 3 ? letters : 'EGP';
}

/**
 * Ask the LLM to parse sheet/table text into a list of transactions.
 * Handles CSV, tab-separated, or free-form table paste.
 */
export async function extractTransactionsFromSheet(
  config: SheetMergeConfig,
  sheetText: string,
  userCategoryNames: string[],
  learningExamples: LearningExample[] = []
): Promise<ExtractedSheetRow[]> {
  const trimmed = (sheetText || '').trim();
  if (!trimmed) return [];

  const categoryHint =
    userCategoryNames.length > 0
      ? `The user has these categories: ${JSON.stringify(userCategoryNames)}. When the sheet has a category column, map values to the closest existing name when possible (e.g. "Food & Groceries" → "Groceries", "Medical" → "Healthcare").`
      : 'Infer short category names from the sheet (e.g. Food, Transport, Bills).';

  let learningBlock = '';
  if (learningExamples.length > 0) {
    const examplesText = learningExamples
      .slice(0, 80)
      .map(
        (ex) =>
          `  merchant: ${ex.merchant ?? '(none)'}, category: ${ex.category}${(ex.tags?.length ?? 0) > 0 ? `, tags: [${(ex.tags ?? []).join(', ')}]` : ''}`
      )
      .join('\n');
    learningBlock = `

USER'S PAST CATEGORIZATIONS (priority over your own suggestion):
When a row's merchant is the SAME or very similar to one below, you MUST use that transaction's category. The user's choice has priority. Only use a different category when the merchant is clearly different from all entries below.
${examplesText}
`;
  }

  const currentYear = new Date().getFullYear();
  const systemPrompt = `You are a precise parser for spreadsheet/table data (CSV, tab-separated, or pasted table).

INPUT: The user will paste raw sheet content (columns might be: date, amount, category, merchant, description, etc.).

OUTPUT: Reply with ONLY a valid JSON object, no other text:
{"rows": [ {"amount": <number>, "currency": "<code>", "date": "YYYY-MM-DD", "category_name": "<string>", "merchant": "<string or null>", "raw_line": "<exact line(s) from the sheet input that this row was parsed from, copy verbatim>"}, ... ]}
${learningBlock}

Rules:
- Parse every data row that contains an amount. Skip header rows and empty rows.
- amount: numeric value only (e.g. 790, 123.50). If multiple amount-like columns, use the main transaction amount.
- currency: from sheet or default "EGP".
- date: normalize to YYYY-MM-DD. When the sheet has NO year (e.g. only "23/02", "02-23", "Feb 23", "23 Feb"), use the current year ${currentYear}. When the sheet includes a year, use it. Interpret DD/MM/YYYY, MM-DD-YYYY, or "Jan 15 2025" etc.
- category_name: ${categoryHint}
- merchant: vendor/description from the sheet if present, else null.
- raw_line: copy the exact line or lines from the user's sheet content that produced this row (so the user can identify the source). Required.
- If the sheet has no clear category column, use category_name "Other" or infer from description.`;

  const body = {
    model: config.model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Sheet content:\n${trimmed.slice(0, 80_000)}` },
    ],
    max_completion_tokens: 8192,
    temperature: 0.1,
  };

  const baseURL = (config.baseURL || DEFAULT_BASE).replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Sheet parse timed out. Try a smaller paste.');
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return [];

  const parsed = parseSheetJson(content);
  const arr = parsed?.rows;
  if (!Array.isArray(arr)) return [];

  const out: ExtractedSheetRow[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (item == null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const amount = Number(o.amount);
    if (Number.isNaN(amount)) continue;
    let dateStr: string;
    try {
      dateStr = normalizeDateToYYYYMMDD(o.date) || new Date().toISOString().slice(0, 10);
    } catch {
      dateStr = new Date().toISOString().slice(0, 10);
    }
    const currency = normalizeCurrency(o.currency);
    const category_name =
      typeof o.category_name === 'string' && o.category_name.trim()
        ? o.category_name.trim().slice(0, 80)
        : 'Other';
    const merchant =
      typeof o.merchant === 'string' && o.merchant.trim()
        ? o.merchant.trim().slice(0, 200)
        : null;
    const raw_line =
      typeof o.raw_line === 'string' && o.raw_line.trim()
        ? o.raw_line.trim().slice(0, 500)
        : null;
    out.push({
      amount: Math.round(amount * 100) / 100,
      currency,
      date: dateStr,
      category_name,
      merchant,
      raw_line: raw_line ?? undefined,
    });
  }
  return out;
}

function parseSheetJson(content: string): { rows?: unknown[] } | null {
  const stripped = content.replace(/```json?\s*/gi, '').replace(/```\s*$/g, '').trim();
  try {
    return JSON.parse(stripped) as { rows?: unknown[] };
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as { rows?: unknown[] };
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/**
 * Ask the LLM to match each extracted sheet row to an existing transaction or null.
 * Uses amount tolerance (e.g. 790 ≈ 788), same date, and category semantic similarity.
 */
export async function matchSheetRowsToExisting(
  config: SheetMergeConfig,
  extracted: ExtractedSheetRow[],
  existing: ExistingTransactionForMatch[]
): Promise<Map<number, string | null>> {
  const matchByIndex = new Map<number, string | null>();
  if (extracted.length === 0) return matchByIndex;
  if (existing.length === 0) {
    extracted.forEach((_, i) => matchByIndex.set(i, null));
    return matchByIndex;
  }

  const systemPrompt = `You match sheet-imported transactions to existing transactions. All three conditions below must be satisfied for a match. Do NOT match if any condition fails.

STRICT RULES (all required):
1. Amount: the absolute difference between sheet amount and existing amount must be at most 30. E.g. sheet 790 can match existing 760–820 only. Sheet 100 can match 70–130. If the difference is 31 or more, do NOT match.
2. Category: must be the same or clearly similar (semantic match). "Food & Groceries" = "Groceries", "Medical" = "Healthcare", "Transport" = "Transportation". Different categories (e.g. Food vs Transport) = no match.
3. Date: the two dates must be within 2 days of each other (same day, or ±1 day, or ±2 days max). E.g. sheet 2025-01-15 can match existing 2025-01-13, 2025-01-14, 2025-01-15, 2025-01-16, 2025-01-17 only. If the existing transaction is 3+ days away, do NOT match.

When in doubt, return null. Only output an existing transaction id when amount diff ≤ 30, category matches or is equivalent, and date is within ±2 days.

Reply with ONLY a valid JSON object:
{"matches": [ <existing_id or null>, <existing_id or null>, ... ]}
The array length must equal the number of sheet rows. Order corresponds to sheet row index.`;

  const sheetSummary = extracted
    .map(
      (r, i) =>
        `[${i}] amount=${r.amount} date=${r.date} category="${r.category_name}" merchant=${r.merchant ?? 'null'}`
    )
    .join('\n');
  const existingSummary = existing
    .map((t) => `id=${t.id} amount=${t.amount} date=${t.date} category="${t.category_name}" merchant=${t.merchant ?? 'null'}`)
    .join('\n');

  const userPrompt = `Sheet rows (index, amount, date, category, merchant):
${sheetSummary}

Existing transactions (id, amount, date, category, merchant):
${existingSummary}

For each sheet row [0] to [${extracted.length - 1}], give one entry in "matches": the existing transaction id only if (1) |sheet amount - existing amount| ≤ 30, (2) category is same or equivalent, (3) dates are within ±2 days. Otherwise null.`;

  const body = {
    model: config.model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 4096,
    temperature: 0,
  };

  const baseURL = (config.baseURL || DEFAULT_BASE).replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Matching timed out.');
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    extracted.forEach((_, i) => matchByIndex.set(i, null));
    return matchByIndex;
  }

  const parsed = parseMatchJson(content);
  const matches = parsed?.matches;
  if (Array.isArray(matches)) {
    const existingIds = new Set(existing.map((t) => t.id));
    extracted.forEach((_, i) => {
      const id = matches[i];
      if (typeof id === 'string' && existingIds.has(id)) {
        matchByIndex.set(i, id);
      } else {
        matchByIndex.set(i, null);
      }
    });
  } else {
    extracted.forEach((_, i) => matchByIndex.set(i, null));
  }
  return matchByIndex;
}

function parseMatchJson(content: string): { matches?: (string | null)[] } | null {
  const stripped = content.replace(/```json?\s*/gi, '').replace(/```\s*$/g, '').trim();
  try {
    return JSON.parse(stripped) as { matches?: (string | null)[] };
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as { matches?: (string | null)[] };
      } catch {
        // ignore
      }
    }
  }
  return null;
}
