/**
 * Extract transactions from a receipt/bill image using OpenAI Vision.
 * Returns the same shape as SMS extract so the merge/match wizard can reuse the same flow.
 */
import { normalizeDateToYYYYMMDD } from '../lib/date';
import type { LearningExample } from './sms-extract';

export interface ImageExtractConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export interface ExtractedImageTransaction {
  amount: number;
  currency: string;
  date: string;
  time: string;
  merchant: string | null;
  suggested_category: string | null;
  source_snippet: string | null;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_COMPLETION_TOKENS = 4096;

function buildPrompt(userCategoryNames: string[], learningExamples: LearningExample[] = []): string {
  const categoryHint =
    userCategoryNames.length > 0
      ? `The user has these categories: ${JSON.stringify(userCategoryNames)}. Prefer these names when a line fits (e.g. Groceries, Transport, Bills).`
      : 'Suggest a short category name (e.g. Groceries, Transport, Bills, Subscriptions, Other).';

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
The list below shows how this user categorized past transactions. When the receipt/image shows the SAME merchant or a very similar one (e.g. same brand, same venue), you MUST use that transaction's category. The user's choice has priority. Only suggest a different category when the merchant is clearly different from all entries below.
${examplesText}
`;
  }

  return `Look at this image (receipt, bill, or transaction list). Extract every distinct financial transaction.
The image may contain handwritten or printed Arabic text and Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩). Transcribe carefully:
- Convert Arabic-Indic digits to Western digits (0-9) in your output for amounts and dates.
- Read handwritten Arabic words character-by-character if needed; merchant names and labels may be in Arabic.
- For amounts, output a single number (e.g. 50.00). For dates, output YYYY-MM-DD when you can infer the full date; if you only see two numbers (e.g. 03/11 or 11/03), output the date in a consistent format (e.g. YYYY-MM-DD using the order shown) — we will disambiguate day/month using the user's expected month.

Reply with ONLY a valid JSON object, no other text:
{"transactions": [ {"amount": <number>, "currency": "<code>", "date": "YYYY-MM-DD", "time": "HH:mm", "merchant": "<vendor or null>", "suggested_category": "<category>", "source_snippet": "<short line from the image describing this line item>"}, ... ]}

Rules:
- amount: the paid/spent amount as a number. Use Western digits only. For "٥٠" or "50" or "50.00 EGP" use 50.00.
- currency: EGP, USD, SAR, AED, etc. from the image. Default EGP if not visible.
- date: YYYY-MM-DD. If the receipt has only day/month (two numbers), use current year ${new Date().getFullYear()} and preserve the two numbers in a clear order (e.g. if you see ١١/٣ or 11/3, output a date with day and month; in MENA day/month is common so 11/3 often means 11 March).
- time: 24h (HH:mm) if visible, else "00:00".
- merchant: vendor/store name in the script used (Arabic or Latin); output as-is or transliterated so the user can recognise it.
- suggested_category: ${categoryHint}${learningBlock}
- source_snippet: a short line from the image for this transaction (or a brief description) so the user can identify it.
- If you see only ONE total (single transaction), return one object. If you see multiple line items, return one object per transaction.
- Do not return an empty transactions array. If nothing looks like a transaction, return one object with the total amount and best guess for date/merchant.`;
}

function parseJsonResponse(content: string): Record<string, unknown> | null {
  const stripped = content.replace(/```json?\s*/gi, '').replace(/```\s*$/g, '').trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeTime(value: unknown): string {
  if (typeof value !== 'string') return '00:00';
  const match = value.trim().match(/(\d{1,2}):(\d{2})/);
  if (match) {
    const h = Math.min(23, Math.max(0, parseInt(match[1], 10)));
    const m = Math.min(59, Math.max(0, parseInt(match[2], 10)));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return '00:00';
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'EGP';
  const letters = value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return letters.length === 3 ? letters : 'EGP';
}

/**
 * Send image to OpenAI Vision and parse transactions from the response.
 */
export async function extractTransactionsFromImage(
  config: ImageExtractConfig,
  imageBase64: string,
  mimeType: string,
  userCategoryNames: string[] = [],
  learningExamples: LearningExample[] = []
): Promise<ExtractedImageTransaction[]> {
  const baseURL = (config.baseURL || DEFAULT_BASE).replace(/\/$/, '');
  const url = `data:${mimeType};base64,${imageBase64}`;

  const body = {
    model: config.model || DEFAULT_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(userCategoryNames, learningExamples) },
          { type: 'image_url', image_url: { url } },
        ],
      },
    ],
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    temperature: 0.1,
  };

  const controller = new AbortController();
  const timeoutMs = 60_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
      throw new Error('Image analysis timed out. Try a smaller image.');
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vision API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('No response from image analysis.');
  }

  const parsed = parseJsonResponse(content);
  const arr = parsed?.transactions;
  if (!Array.isArray(arr) || arr.length === 0) {
    return [];
  }

  const results: ExtractedImageTransaction[] = [];
  for (const item of arr) {
    if (item == null || typeof item !== 'object' || typeof (item as Record<string, unknown>).amount !== 'number') {
      continue;
    }
    const o = item as Record<string, unknown>;
    const amount = Number(o.amount);
    if (Number.isNaN(amount)) continue;

    const dateStr = normalizeDateToYYYYMMDD(o.date) || (typeof o.date === 'string' ? o.date : '');
    const timeStr = normalizeTime(o.time);
    const currency = normalizeCurrency(o.currency);
    const merchant =
      typeof o.merchant === 'string' && o.merchant.trim()
        ? o.merchant.trim().slice(0, 200)
        : null;
    const suggested_category =
      typeof o.suggested_category === 'string' && o.suggested_category.trim()
        ? o.suggested_category.trim().slice(0, 80)
        : null;
    const source_snippet =
      typeof o.source_snippet === 'string' && o.source_snippet.trim()
        ? o.source_snippet.trim().slice(0, 500)
        : null;

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

    results.push({
      amount: Math.round(amount * 100) / 100,
      currency,
      date: dateStr,
      time: timeStr,
      merchant,
      suggested_category,
      source_snippet,
    });
  }

  return results;
}
