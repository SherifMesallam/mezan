/**
 * LLM-based extraction of amount, date, time, merchant, and category from raw SMS text.
 * Supports one or multiple messages in one paste. Redacts card/phone numbers before sending.
 */
import { normalizeDateToYYYYMMDD } from '../lib/date';

export interface SMSExtractConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export interface ExtractedSMS {
  amount: number;
  currency: string;
  date: string;   // YYYY-MM-DD
  time: string;   // HH:mm
  merchant: string | null;
  /** Category name: either matched from user's list or a new suggestion from the LLM */
  suggested_category: string | null;
  /** Exact snippet from the pasted text that this transaction was extracted from (for display in wizard). */
  source_snippet?: string | null;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

/** Redact card and phone numbers; keep amounts and time */
function redactSensitive(text: string): string {
  return text
    .replace(/\d{4}\s*\d{4}\s*\d{4}\s*\d{4}/g, 'XXXX XXXX XXXX XXXX')
    .replace(/\d{4}\s*\d{4}\s*\d{4}/g, 'XXX XXX XXX')
    .replace(/\b\d{5,}\b/g, 'XXXXX');
}

/** Strip chat/app-style prefix so the LLM sees only the SMS body */
function stripPastePrefix(text: string): string {
  const t = text.trim();
  const prefixMatch = t.match(/^\[\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M\]\s*[^:]+:\s*/i);
  if (prefixMatch) return t.slice(prefixMatch[0].length).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(t) && t.includes(':')) {
    const firstLineEnd = t.indexOf('\n');
    const firstLine = firstLineEnd > 0 ? t.slice(0, firstLineEnd) : t;
    if (firstLine.includes(':') && firstLine.length < 80) return (firstLineEnd > 0 ? t.slice(firstLineEnd + 1) : t.slice(firstLine.indexOf(':') + 1)).trim();
  }
  return t;
}

/** One user-confirmed example: merchant they used, category and tags they chose. */
export type LearningExample = { merchant: string | null; category: string; tags: string[] };

/** Build system prompt; injects the user's category list and optional learning examples. */
function buildSystemPrompt(
  userCategoryNames: string[],
  learningExamples: LearningExample[] = []
): string {
  let categorySection =
    userCategoryNames.length > 0
      ? `- suggested_category: The user has these categories: ${JSON.stringify(userCategoryNames)}. Prefer these over suggesting new ones: if the transaction fits one of them, use that exact name (match case if possible). If what you would suggest is very close to an existing category (e.g. user has "Groceries" and you would say "Food/Groceries"), use the user's existing category name exactly. Only suggest a new short name when nothing fits or is close.`
      : `- suggested_category: Suggest a short category name that fits the transaction (e.g. Bills, Food, Transport, Subscriptions, Shopping, Other).`;

  let learningBlock = '';
  if (learningExamples.length > 0) {
    const examplesText = learningExamples
      .slice(0, 25)
      .map(
        (ex) =>
          `  merchant: ${ex.merchant ?? '(none)'}, category: ${ex.category}${ex.tags.length > 0 ? `, tags: [${ex.tags.join(', ')}]` : ''}`
      )
      .join('\n');
    learningBlock = `

LEARN FROM THIS USER'S PAST CHOICES (use these to match similar vendors and categories):
The following are transactions this user manually categorized or tagged. When the new SMS mentions a similar vendor or pattern, prefer the same category (and consider similar tags if you see a tags field in the output later).
${examplesText}
`;
  }

  return `You are a precise parser for payment SMS messages in Arabic and English (MENA region).
${learningBlock}
INPUT: The user will paste one or more SMS messages.

OUTPUT: Reply with ONLY a valid JSON object, no other text. Use this exact shape:
{"transactions": [ {"amount": <number>, "currency": "<code>", "date": "YYYY-MM-DD", "time": "HH:mm", "merchant": "<name or null>", "suggested_category": "<category>", "source_snippet": "<exact substring from the pasted text that describes this transaction, copy verbatim>"}, ... ]}

Rules:
- If the input contains MULTIPLE distinct transactions (different amounts, dates, or merchants), output one object per transaction in the "transactions" array. If there is only ONE transaction, output {"transactions": [ single object ]}. Never return an empty transactions array.
- amount: the charged/spent amount (number only). For "تم خصم 234.99 جم" use 234.99. If multiple amounts in one message, use the debited amount (الخصم / المتاح is balance, not the transaction).
- currency: discover from the message. Use the currency code that appears or is clearly implied: EGP (جم/ج.م), USD, SAR, AED, KWD, etc. Any standard 3-letter code or common abbreviation.
- date: YYYY-MM-DD. CRITICAL — In Egypt/MENA dates are almost always DD/MM (day first, then month). So "06/03/2026" or "6-3" or "يوم 06-03" means 6 March 2026 → output "2026-03-06" (year-month-day in ISO). Do NOT swap: 06/03 is day=6, month=3, so date is "2026-03-06", never "2026-06-03". When only two numbers appear (e.g. 06-03), the first is day and the second is month. When the message has no year, use current year ${new Date().getFullYear()}.
- time: 24h (e.g. "الساعة 13:25" → "13:25").
- merchant: exact vendor name from the message (e.g. APPLE.COM/BILL, DiDi, Fawry, Vodafone). If unclear, null.
- source_snippet: copy the exact substring from the user's pasted text that this transaction was extracted from (one or more lines, verbatim). Required so the user can identify the source.`;
}

/** Max chars per chunk when pasted text is very long (avoids context overflow). */
const CHUNK_CHAR_LIMIT = 60_000;
/** Allow enough tokens for large extraction (many messages → large JSON). */
const MAX_COMPLETION_TOKENS = 16_384;

/**
 * Split long pasted text into chunks so we don't exceed context and get truncated output.
 * Splits on double newline first, then by line count to stay under CHUNK_CHAR_LIMIT.
 */
function chunkPastedText(text: string): string[] {
  if (text.length <= CHUNK_CHAR_LIMIT) return [text];
  const chunks: string[] = [];
  const blocks = text.split(/\n\n+/);
  let current = '';
  for (const block of blocks) {
    if (current.length + block.length + 2 <= CHUNK_CHAR_LIMIT) {
      current += (current ? '\n\n' : '') + block;
    } else {
      if (current) chunks.push(current);
      if (block.length > CHUNK_CHAR_LIMIT) {
        const lines = block.split('\n');
        let lineChunk = '';
        for (const line of lines) {
          if (lineChunk.length + line.length + 1 > CHUNK_CHAR_LIMIT && lineChunk) {
            chunks.push(lineChunk);
            lineChunk = line;
          } else {
            lineChunk += (lineChunk ? '\n' : '') + line;
          }
        }
        if (lineChunk) current = lineChunk;
      } else {
        current = block;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Extract one or more transactions from raw pasted text. The LLM decides how many messages there are.
 * Pass userCategoryNames so the LLM can match one of the user's categories or suggest a new one.
 * Long pastes are chunked and extracted in batches, then merged.
 */
export async function extractTransactionsFromSMS(
  config: SMSExtractConfig,
  rawSms: string,
  options?: { userCategoryNames?: string[]; learningExamples?: LearningExample[] }
): Promise<ExtractedSMS[]> {
  const trimmed = stripPastePrefix((rawSms || '').trim());
  if (!trimmed) return [];

  const redacted = redactSensitive(trimmed);
  const userCategoryNames = options?.userCategoryNames ?? [];
  const learningExamples = options?.learningExamples ?? [];

  const chunks = chunkPastedText(redacted);
  const allResults: ExtractedSMS[] = [];

  for (const chunk of chunks) {
    const userPrompt = `Pasted text (sensitive numbers redacted):\n${chunk}`;

    const body = {
      model: config.model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt(userCategoryNames, learningExamples) },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      temperature: 0.1,
    };

    const baseURL = (config.baseURL || DEFAULT_BASE).replace(/\/$/, '');
    const controller = new AbortController();
    const timeoutMs = 120_000; // 2 min per chunk so we don't hang forever
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
        throw new Error('AI request timed out. Try with fewer messages.');
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
      console.log('[SMS-EXTRACT] LLM returned empty content for chunk');
      continue;
    }
    const logContent = content.length > 2000 ? content.slice(0, 2000) + '...[truncated]' : content;
    console.log('[SMS-EXTRACT] LLM raw response:', logContent);

    const parsed = parseJsonResponse(content);
    const arr = parsed?.transactions;
    if (!Array.isArray(arr)) {
      console.log('[SMS-EXTRACT] Parsed result has no transactions array. parsed=', parsed ? 'object' : 'null');
      continue;
    }
    console.log('[SMS-EXTRACT] Parsed transactions from chunk:', JSON.stringify(arr, null, 2));

    for (const item of arr) {
      if (item == null || typeof item !== 'object' || typeof (item as Record<string, unknown>).amount !== 'number') continue;
      const o = item as Record<string, unknown>;
      const amount = Number((o.amount as number));
      if (Number.isNaN(amount)) continue;
      const dateStr = normalizeDateToYYYYMMDD(o.date) || normalizeDate(o.date);
      const timeStr = normalizeTime(o.time);
      let currency = normalizeCurrency(o.currency);
      if (currency === 'EGP') {
        const inferred = inferCurrencyFromSnippet(o.source_snippet as string | null | undefined);
        if (inferred) {
          console.log('[SMS-EXTRACT] Currency inferred from snippet:', { llm_currency: o.currency, inferred, snippet: (o.source_snippet as string)?.slice(0, 80) });
          currency = inferred;
        }
      }
      console.log('[SMS-EXTRACT] Row result:', { amount, currency, date: dateStr, merchant: (o.merchant as string)?.slice(0, 40) });
      const merchant = typeof o.merchant === 'string' && o.merchant.trim()
        ? o.merchant.trim().slice(0, 200)
        : null;
      const suggested_category: string | null = typeof o.suggested_category === 'string' && o.suggested_category.trim()
        ? o.suggested_category.trim().slice(0, 80)
        : null;
      const source_snippet: string | null = typeof o.source_snippet === 'string' && o.source_snippet.trim()
        ? o.source_snippet.trim().slice(0, 500)
        : null;

      allResults.push({
        amount: Math.round(amount * 100) / 100,
        currency,
        date: dateStr,
        time: timeStr,
        merchant,
        suggested_category,
        source_snippet: source_snippet ?? undefined,
      });
    }
  }

  return allResults;
}

/** Single-message convenience: returns first extracted transaction or null. */
export async function extractTransactionFromSMS(
  config: SMSExtractConfig,
  rawSms: string
): Promise<ExtractedSMS | null> {
  const list = await extractTransactionsFromSMS(config, rawSms);
  return list.length > 0 ? list[0] : null;
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
        return parseTruncatedTransactionsJson(stripped);
      }
    }
    return parseTruncatedTransactionsJson(stripped);
  }
}

/** Try to extract transactions array from truncated or malformed JSON (e.g. cut off at end). */
function parseTruncatedTransactionsJson(stripped: string): Record<string, unknown> | null {
  const start = stripped.indexOf('"transactions"');
  if (start === -1) return null;
  const arrayStart = stripped.indexOf('[', start);
  if (arrayStart === -1) return null;
  const items: Record<string, unknown>[] = [];
  let depth = 1;
  let i = arrayStart + 1;
  let objStart = -1;
  while (i < stripped.length && depth > 0) {
    const c = stripped[i];
    if (c === '{') {
      if (depth === 1) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 1 && objStart >= 0) {
        try {
          const obj = JSON.parse(stripped.slice(objStart, i + 1)) as Record<string, unknown>;
          if (typeof obj.amount === 'number') items.push(obj);
        } catch {
          // skip malformed object
        }
        objStart = -1;
      }
    } else if (c === '[') depth++;
    else if (c === ']') depth--;
    i++;
  }
  if (items.length === 0) return null;
  return { transactions: items };
}

function normalizeDate(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString().slice(0, 10);
  const s = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
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

/** Known non-EGP currency codes we infer from message text when LLM omits currency. */
const INFERRABLE_CURRENCIES = ['USD', 'SAR', 'AED', 'KWD', 'BHD', 'QAR', 'OMR', 'EUR', 'GBP'];

/** Infer currency from snippet (e.g. "USD 49.50" or "balance.USD") when LLM omitted it. */
function inferCurrencyFromSnippet(snippet: string | null | undefined): string | null {
  if (!snippet || typeof snippet !== 'string') return null;
  const upper = snippet.toUpperCase();
  for (const code of INFERRABLE_CURRENCIES) {
    // Match whole-word style: "USD 49", "USD49", ".USD", "balance USD"
    if (new RegExp(`\\b${code}\\b|\\b${code}\\d|[\\.\\s]${code}[\\s\\d]`).test(upper)) return code;
  }
  return null;
}

/** Keep currency as discovered by the LLM (e.g. EGP, USD, SAR, AED); default EGP if missing. */
function normalizeCurrency(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'EGP';
  const letters = value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return letters.length === 3 ? letters : 'EGP';
}
