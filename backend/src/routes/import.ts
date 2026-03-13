import { Router } from 'express';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma';
import { normalizeDateToYYYYMMDD } from '../lib/date';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ensureDefaultCategories } from '../lib/seedDefaultCategories';
import { suggestCategory } from '../services/categorization';
import { amountToEgp } from '../services/exchange-rates';
import {
  extractTransactionsFromSheet,
  matchSheetRowsToExisting,
  type ExistingTransactionForMatch,
} from '../services/sheet-merge';
import { extractTransactionsFromSMS } from '../services/sms-extract';
import { extractTransactionsFromImage } from '../services/image-extract';
import { transcribeAudio, TRANSACTION_PROMPT } from '../services/voice-transcribe';
import { getLearningTransactionsForUser } from './ingest';

export const importRouter = Router();
importRouter.use(authMiddleware);

/**
 * POST /v1/import/sheet-merge-preview
 * Body: { sheet_text: string }
 * Returns extracted rows from the sheet and their matched existing transaction (if any).
 */
importRouter.post('/sheet-merge-preview', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const sheetText = typeof req.body?.sheet_text === 'string' ? req.body.sheet_text : '';
    if (!sheetText.trim()) {
      res.status(422).json({ error: 'sheet_text is required' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      res.status(501).json({
        error: 'AI not configured. Set OPENAI_API_KEY in backend .env.',
      });
      return;
    }

    const [categories, transactions, learningExamples] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 2000,
        include: { category: { select: { name: true } } },
      }),
      getLearningTransactionsForUser(userId),
    ]);

    const userCategoryNames = categories.map((c) => c.name.trim()).filter(Boolean);
    const extracted = await extractTransactionsFromSheet(
      {
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      },
      sheetText,
      userCategoryNames,
      learningExamples
    );

    if (extracted.length === 0) {
      res.json({ items: [] });
      return;
    }

    const existingForMatch: ExistingTransactionForMatch[] = transactions.map((t) => ({
      id: t.id,
      amount: Number(t.amount),
      date: t.date,
      category_name: t.category?.name?.trim() ?? '',
      merchant: t.merchant,
    }));

    const matchByIndex = await matchSheetRowsToExisting(
      {
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      },
      extracted,
      existingForMatch
    );

    const existingById = new Map(existingForMatch.map((t) => [t.id, t]));

    const items = extracted.map((row, i) => {
      const matchedId = matchByIndex.get(i) ?? null;
      const matched_entry = matchedId ? existingById.get(matchedId) ?? null : null;
      return {
        sheet_index: i,
        amount: row.amount,
        currency: row.currency,
        date: row.date,
        category_name: row.category_name,
        merchant: row.merchant,
        raw_line: row.raw_line ?? null,
        matched_entry_id: matchedId,
        matched_entry,
      };
    });

    res.json({ items });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to parse or match sheet',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});

/**
 * POST /v1/import/sms-merge-preview
 * Body: { raw_text: string }
 * Extracts transactions from pasted SMS and matches each to an existing transaction (amount ±30, date ±2 days, same category).
 * Returns items so the frontend can show the same match wizard as sheet import.
 */
importRouter.post('/sms-merge-preview', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const rawText = typeof req.body?.raw_text === 'string' ? req.body.raw_text.trim() : '';
    if (!rawText) {
      res.status(422).json({ error: 'raw_text is required' });
      return;
    }
    const rawMonths = req.body?.expected_months;
    const expected_months: number[] = Array.isArray(rawMonths)
      ? rawMonths
          .map((m: unknown) => (typeof m === 'number' ? m : parseInt(String(m), 10)))
          .filter((m: number) => Number.isFinite(m) && m >= 1 && m <= 12)
      : [];

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      res.status(501).json({
        error: 'AI not configured. Set OPENAI_API_KEY in backend .env.',
      });
      return;
    }

    const [categories, existingTx, learningExamples] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 2000,
        include: { category: { select: { name: true } } },
      }),
      getLearningTransactionsForUser(userId),
    ]);

    const userCategoryNames = categories.map((c) => c.name.trim()).filter(Boolean);
    const extracted = await extractTransactionsFromSMS(
      {
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      },
      rawText,
      { userCategoryNames, learningExamples }
    );

    // Log AI extraction response for debugging matching
    const logPrefix = '[SMS-MERGE]';
    console.log(`${logPrefix} AI extracted ${extracted.length} transaction(s):`, JSON.stringify(extracted, null, 2));
    console.log(
      `${logPrefix} User categories (name -> id):`,
      JSON.stringify(
        categories.map((c) => ({ name: c.name, id: c.id })),
        null,
        2
      )
    );
    const existingDateRange =
      existingTx.length > 0
        ? { min: existingTx[existingTx.length - 1]?.date, max: existingTx[0]?.date, count: existingTx.length }
        : { count: 0 };
    console.log(`${logPrefix} Existing transactions:`, JSON.stringify(existingDateRange));

    if (extracted.length === 0) {
      res.json({ items: [] });
      return;
    }

    /** Prisma Decimal or number to number (avoids NaN from Decimal in filter). */
    function toAmountNum(t: { amount: unknown }): number {
      const v = t.amount;
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
      if (v != null && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
        return (v as { toNumber: () => number }).toNumber();
      }
      return Number(v);
    }

    const categoryNameToId = new Map<string, string>();
    const categoryIdToName = new Map<string, string>();
    const categoryNamesLower: { id: string; nameLower: string }[] = [];
    for (const c of categories) {
      const key = c.name.trim().toLowerCase();
      if (key) {
        categoryNameToId.set(key, c.id);
        categoryIdToName.set(c.id, c.name);
        categoryNamesLower.push({ id: c.id, nameLower: key });
      }
    }

    /** Resolve AI suggested category to a user category id: exact match first, then fuzzy (user category contains suggested or vice versa). */
    function resolveCategoryId(suggested: string): string | null {
      const s = suggested.trim().toLowerCase();
      if (!s) return null;
      const exact = categoryNameToId.get(s);
      if (exact) return exact;
      for (const { id, nameLower } of categoryNamesLower) {
        if (nameLower.includes(s) || s.includes(nameLower)) return id;
      }
      return null;
    }

    function dateAddDays(dateStr: string, days: number): string {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + days);
      return dt.toISOString().slice(0, 10);
    }

    /** If YYYY-MM-DD has both month and day <= 12, return YYYY-DD-MM (swap) for defensive matching when LLM swaps day/month. */
    function trySwapDayMonth(iso: string): string | null {
      const parts = iso.split('-').map(Number);
      if (parts.length !== 3) return null;
      const [y, m, d] = parts;
      if (m <= 12 && d <= 12 && m !== d) {
        return `${y}-${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
      }
      return null;
    }

    const items = extracted.map((ext, i) => {
      console.log(`${logPrefix} Preview row ${i} extracted:`, { amount: ext.amount, currency: ext.currency, merchant: ext.merchant?.slice(0, 30) });
      const dateNorm = normalizeDateToYYYYMMDD(ext.date, expected_months.length > 0 ? expected_months : undefined);
      if (!dateNorm) {
        console.log(`${logPrefix} Row ${i}: date could not be normalized -> no match. ext.date=${JSON.stringify(ext.date)}`);
        return {
          sheet_index: i,
          amount: ext.amount,
          currency: ext.currency ?? 'EGP',
          date: ext.date,
          time: ext.time,
          category_name: ext.suggested_category ?? 'Other',
          merchant: ext.merchant,
          source_snippet: ext.source_snippet ?? null,
          matched_entry_id: null,
          matched_entry: null,
        };
      }
      const suggestedCat = ext.suggested_category ?? '';
      const resolvedCategoryId = resolveCategoryId(suggestedCat);
      const resolvedCategoryName = resolvedCategoryId ? categoryIdToName.get(resolvedCategoryId) ?? resolvedCategoryId : null;
      const amountLo = ext.amount - 30;
      const amountHi = ext.amount + 30;
      const extCurrency = (ext.currency && String(ext.currency).trim().toUpperCase().slice(0, 3)) || 'EGP';

      function sameCurrency(t: { currency: string }): boolean {
        const c = (t.currency && String(t.currency).trim().toUpperCase().slice(0, 3)) || 'EGP';
        return c === extCurrency;
      }

      function candidatesForDateRange(dateFrom: string, dateTo: string, requireCategory: boolean) {
        return existingTx.filter((t) => {
          const amt = toAmountNum(t);
          const amountOk = amt >= amountLo && amt <= amountHi;
          const dateOk = t.date >= dateFrom && t.date <= dateTo;
          const currencyOk = sameCurrency(t);
          const categoryOk = !requireCategory || t.categoryId === resolvedCategoryId;
          return currencyOk && amountOk && dateOk && categoryOk;
        });
      }

      let dateFrom = dateAddDays(dateNorm, -2);
      let dateTo = dateAddDays(dateNorm, 2);
      let candidates = candidatesForDateRange(dateFrom, dateTo, true);
      let dateUsed = dateNorm;
      let dateCorrected = false;

      if (candidates.length === 0) {
        candidates = candidatesForDateRange(dateFrom, dateTo, false);
      }

      // If no match and date is ambiguous (month/day both <= 12), try swapped interpretation (LLM often outputs YYYY-DD-MM as YYYY-MM-DD).
      if (candidates.length === 0) {
        const swapped = trySwapDayMonth(dateNorm);
        if (swapped) {
          const dateFromSwap = dateAddDays(swapped, -2);
          const dateToSwap = dateAddDays(swapped, 2);
          let candidatesSwap = candidatesForDateRange(dateFromSwap, dateToSwap, true);
          if (candidatesSwap.length === 0) candidatesSwap = candidatesForDateRange(dateFromSwap, dateToSwap, false);
          if (candidatesSwap.length > 0) {
            candidates = candidatesSwap;
            dateFrom = dateFromSwap;
            dateTo = dateToSwap;
            dateUsed = swapped;
            dateCorrected = true;
          }
        }
      }

      const best =
        candidates.length === 0
          ? null
          : candidates.reduce((a, b) =>
              Math.abs(toAmountNum(a) - ext.amount) <= Math.abs(toAmountNum(b) - ext.amount) ? a : b
            );

      // Log matching trial for this row
      console.log(
        `${logPrefix} Row ${i} match trial:`,
        JSON.stringify({
          extracted: {
            amount: ext.amount,
            currency: ext.currency,
            date_raw: ext.date,
            date_normalized: dateNorm,
            date_swapped_tried: trySwapDayMonth(dateNorm) ?? undefined,
            date_corrected: dateCorrected || undefined,
            suggested_category: suggestedCat || null,
            merchant: ext.merchant,
          },
          resolved_category: resolvedCategoryId
            ? { id: resolvedCategoryId, name: resolvedCategoryName }
            : null,
          filter: { amountLo, amountHi, dateFrom, dateTo, currency: extCurrency },
          candidates_count: candidates.length,
          result: best
            ? { id: best.id, amount: toAmountNum(best), currency: (best as { currency?: string }).currency, date: best.date, category: best.category?.name }
            : 'no match',
        })
      );

      const matched_entry = best
        ? {
            id: best.id,
            amount: toAmountNum(best),
            date: best.date,
            category_name: best.category?.name?.trim() ?? '',
            merchant: best.merchant,
          }
        : null;

      const item = {
        sheet_index: i,
        amount: ext.amount,
        currency: ext.currency ?? 'EGP',
        date: dateUsed,
        time: ext.time,
        category_name: ext.suggested_category ?? 'Other',
        merchant: ext.merchant,
        source_snippet: ext.source_snippet ?? null,
        matched_entry_id: best?.id ?? null,
        matched_entry,
      };
      console.log(`${logPrefix} Preview row ${i} response:`, { currency: item.currency, amount: item.amount });
      return item;
    });

    res.json({ items });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to parse or match SMS',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});

/**
 * POST /v1/import/voice-merge-preview
 * Body: { audio_base64: string, mime_type?: string } (e.g. audio/webm, audio/mp4)
 * Transcribes with Whisper, extracts transactions (with learning data), defaults missing date to today, matches like SMS.
 * Returns same items shape as sms-merge-preview for the match wizard.
 */
importRouter.post('/voice-merge-preview', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const audioBase64 = typeof req.body?.audio_base64 === 'string' ? req.body.audio_base64.trim() : '';
    const mimeType = typeof req.body?.mime_type === 'string' ? req.body.mime_type.trim() : 'audio/webm';
    if (!audioBase64) {
      res.status(422).json({ error: 'audio_base64 is required' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      res.status(501).json({
        error: 'AI not configured. Set OPENAI_API_KEY in backend .env.',
      });
      return;
    }

    const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
    const whisperBaseURL = process.env.OPENAI_WHISPER_BASE_URL?.trim() || undefined;
    const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || undefined;
    const transcribed = await transcribeAudio(
      {
        apiKey,
        baseURL,
        whisperBaseURL,
        model: transcribeModel,
        prompt: TRANSACTION_PROMPT,
      },
      audioBase64,
      mimeType
    );
    const rawText = transcribed.trim();
    if (!rawText) {
      res.json({ items: [] });
      return;
    }

    const [categories, existingTx, learningExamples] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 2000,
        include: { category: { select: { name: true } } },
      }),
      getLearningTransactionsForUser(userId),
    ]);

    const userCategoryNames = categories.map((c) => c.name.trim()).filter(Boolean);
    let extracted = await extractTransactionsFromSMS(
      {
        apiKey,
        baseURL: baseURL || undefined,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      },
      rawText,
      { userCategoryNames, learningExamples }
    );

    const todayIso = new Date().toISOString().slice(0, 10);
    extracted = extracted.map((ext) => {
      const normalized = normalizeDateToYYYYMMDD(ext.date);
      if (!normalized) {
        return { ...ext, date: todayIso };
      }
      return ext;
    });

    const logPrefix = '[VOICE-MERGE]';
    console.log(`${logPrefix} Transcribed (${rawText.length} chars):`, rawText.slice(0, 200));
    console.log(`${logPrefix} AI extracted ${extracted.length} transaction(s)`);

    if (extracted.length === 0) {
      res.json({ items: [] });
      return;
    }

    function toAmountNum(t: { amount: unknown }): number {
      const v = t.amount;
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
      if (v != null && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
        return (v as { toNumber: () => number }).toNumber();
      }
      return Number(v);
    }

    const categoryNameToId = new Map<string, string>();
    const categoryIdToName = new Map<string, string>();
    const categoryNamesLower: { id: string; nameLower: string }[] = [];
    for (const c of categories) {
      const key = c.name.trim().toLowerCase();
      if (key) {
        categoryNameToId.set(key, c.id);
        categoryIdToName.set(c.id, c.name);
        categoryNamesLower.push({ id: c.id, nameLower: key });
      }
    }

    function resolveCategoryId(suggested: string): string | null {
      const s = suggested.trim().toLowerCase();
      if (!s) return null;
      const exact = categoryNameToId.get(s);
      if (exact) return exact;
      for (const { id, nameLower } of categoryNamesLower) {
        if (nameLower.includes(s) || s.includes(nameLower)) return id;
      }
      return null;
    }

    function dateAddDays(dateStr: string, days: number): string {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + days);
      return dt.toISOString().slice(0, 10);
    }

    function trySwapDayMonth(iso: string): string | null {
      const parts = iso.split('-').map(Number);
      if (parts.length !== 3) return null;
      const [y, m, d] = parts;
      if (m <= 12 && d <= 12 && m !== d) {
        return `${y}-${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
      }
      return null;
    }

    const expected_months: number[] = [];

    const items = extracted.map((ext, i) => {
      const dateNorm = normalizeDateToYYYYMMDD(ext.date, expected_months.length > 0 ? expected_months : undefined);
      if (!dateNorm) {
        return {
          sheet_index: i,
          amount: ext.amount,
          currency: ext.currency ?? 'EGP',
          date: ext.date,
          time: ext.time,
          category_name: ext.suggested_category ?? 'Other',
          merchant: ext.merchant,
          source_snippet: ext.source_snippet ?? null,
          matched_entry_id: null,
          matched_entry: null,
        };
      }
      const suggestedCat = ext.suggested_category ?? '';
      const resolvedCategoryId = resolveCategoryId(suggestedCat);
      const amountLo = ext.amount - 30;
      const amountHi = ext.amount + 30;
      const extCurrency = (ext.currency && String(ext.currency).trim().toUpperCase().slice(0, 3)) || 'EGP';

      function sameCurrency(t: { currency: string }): boolean {
        const c = (t.currency && String(t.currency).trim().toUpperCase().slice(0, 3)) || 'EGP';
        return c === extCurrency;
      }

      function candidatesForDateRange(dateFrom: string, dateTo: string, requireCategory: boolean) {
        return existingTx.filter((t) => {
          const amt = toAmountNum(t);
          const amountOk = amt >= amountLo && amt <= amountHi;
          const dateOk = t.date >= dateFrom && t.date <= dateTo;
          const currencyOk = sameCurrency(t);
          const categoryOk = !requireCategory || t.categoryId === resolvedCategoryId;
          return currencyOk && amountOk && dateOk && categoryOk;
        });
      }

      let dateFrom = dateAddDays(dateNorm, -2);
      let dateTo = dateAddDays(dateNorm, 2);
      let candidates = candidatesForDateRange(dateFrom, dateTo, true);
      let dateUsed = dateNorm;

      if (candidates.length === 0) {
        candidates = candidatesForDateRange(dateFrom, dateTo, false);
      }
      if (candidates.length === 0) {
        const swapped = trySwapDayMonth(dateNorm);
        if (swapped) {
          const dateFromSwap = dateAddDays(swapped, -2);
          const dateToSwap = dateAddDays(swapped, 2);
          let candidatesSwap = candidatesForDateRange(dateFromSwap, dateToSwap, true);
          if (candidatesSwap.length === 0) candidatesSwap = candidatesForDateRange(dateFromSwap, dateToSwap, false);
          if (candidatesSwap.length > 0) {
            candidates = candidatesSwap;
            dateUsed = swapped;
          }
        }
      }

      const best =
        candidates.length === 0
          ? null
          : candidates.reduce((a, b) =>
              Math.abs(toAmountNum(a) - ext.amount) <= Math.abs(toAmountNum(b) - ext.amount) ? a : b
            );

      const matched_entry = best
        ? {
            id: best.id,
            amount: toAmountNum(best),
            date: best.date,
            category_name: best.category?.name?.trim() ?? '',
            merchant: best.merchant,
          }
        : null;

      return {
        sheet_index: i,
        amount: ext.amount,
        currency: ext.currency ?? 'EGP',
        date: dateUsed,
        time: ext.time,
        category_name: ext.suggested_category ?? 'Other',
        merchant: ext.merchant,
        source_snippet: ext.source_snippet ?? null,
        matched_entry_id: best?.id ?? null,
        matched_entry,
      };
    });

    res.json({ items });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to transcribe or parse voice',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});

/**
 * POST /v1/import/image-merge-preview
 * Body: { image_base64: string, mime_type: string } (e.g. image/jpeg, image/png)
 * Runs OCR + extraction via OpenAI Vision, then matches to existing transactions.
 * Returns same items shape as sms-merge-preview for the match wizard.
 */
importRouter.post('/image-merge-preview', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const imageBase64 = typeof req.body?.image_base64 === 'string' ? req.body.image_base64.trim() : '';
    const mimeType = typeof req.body?.mime_type === 'string' ? req.body.mime_type.trim() : 'image/jpeg';
    if (!imageBase64) {
      res.status(422).json({ error: 'image_base64 is required' });
      return;
    }
    const rawMonths = req.body?.expected_months;
    const expected_months: number[] = Array.isArray(rawMonths)
      ? rawMonths
          .map((m: unknown) => (typeof m === 'number' ? m : parseInt(String(m), 10)))
          .filter((m: number) => Number.isFinite(m) && m >= 1 && m <= 12)
      : [];

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      res.status(501).json({
        error: 'AI not configured. Set OPENAI_API_KEY in backend .env.',
      });
      return;
    }

    const [categories, existingTx, learningExamples] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 2000,
        include: { category: { select: { name: true } } },
      }),
      getLearningTransactionsForUser(userId),
    ]);

    const userCategoryNames = categories.map((c) => c.name.trim()).filter(Boolean);
    const extracted = await extractTransactionsFromImage(
      {
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      },
      imageBase64,
      mimeType,
      userCategoryNames,
      learningExamples
    );

    if (extracted.length === 0) {
      res.json({ items: [] });
      return;
    }

    function toAmountNum(t: { amount: unknown }): number {
      const v = t.amount;
      if (typeof v === 'number' && !Number.isNaN(v)) return v;
      if (v != null && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
        return (v as { toNumber: () => number }).toNumber();
      }
      return Number(v);
    }

    const categoryNameToId = new Map<string, string>();
    const categoryIdToName = new Map<string, string>();
    const categoryNamesLower: { id: string; nameLower: string }[] = [];
    for (const c of categories) {
      const key = c.name.trim().toLowerCase();
      if (key) {
        categoryNameToId.set(key, c.id);
        categoryIdToName.set(c.id, c.name);
        categoryNamesLower.push({ id: c.id, nameLower: key });
      }
    }

    function resolveCategoryId(suggested: string): string | null {
      const s = suggested.trim().toLowerCase();
      if (!s) return null;
      const exact = categoryNameToId.get(s);
      if (exact) return exact;
      for (const { id, nameLower } of categoryNamesLower) {
        if (nameLower.includes(s) || s.includes(nameLower)) return id;
      }
      return null;
    }

    function dateAddDays(dateStr: string, days: number): string {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      dt.setDate(dt.getDate() + days);
      return dt.toISOString().slice(0, 10);
    }

    function trySwapDayMonth(iso: string): string | null {
      const parts = iso.split('-').map(Number);
      if (parts.length !== 3) return null;
      const [y, m, d] = parts;
      if (m <= 12 && d <= 12 && m !== d) {
        return `${y}-${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
      }
      return null;
    }

    const items = extracted.map((ext, i) => {
      const dateNorm = normalizeDateToYYYYMMDD(ext.date, expected_months.length > 0 ? expected_months : undefined);
      if (!dateNorm) {
        return {
          sheet_index: i,
          amount: ext.amount,
          currency: ext.currency,
          date: ext.date,
          time: ext.time ?? null,
          category_name: ext.suggested_category ?? 'Other',
          merchant: ext.merchant,
          source_snippet: ext.source_snippet ?? null,
          matched_entry_id: null,
          matched_entry: null,
        };
      }
      const suggestedCat = ext.suggested_category ?? '';
      const resolvedCategoryId = resolveCategoryId(suggestedCat);
      const amountLo = ext.amount - 30;
      const amountHi = ext.amount + 30;

      function candidatesForDateRange(dateFrom: string, dateTo: string) {
        if (resolvedCategoryId == null) return [];
        return existingTx.filter((t) => {
          const amt = toAmountNum(t);
          return (
            t.categoryId === resolvedCategoryId &&
            amt >= amountLo &&
            amt <= amountHi &&
            t.date >= dateFrom &&
            t.date <= dateTo
          );
        });
      }

      let dateFrom = dateAddDays(dateNorm, -2);
      let dateTo = dateAddDays(dateNorm, 2);
      let candidates = candidatesForDateRange(dateFrom, dateTo);
      let dateUsed = dateNorm;
      let dateCorrected = false;

      if (candidates.length === 0) {
        const swapped = trySwapDayMonth(dateNorm);
        if (swapped) {
          const dateFromSwap = dateAddDays(swapped, -2);
          const dateToSwap = dateAddDays(swapped, 2);
          const candidatesSwap = candidatesForDateRange(dateFromSwap, dateToSwap);
          if (candidatesSwap.length > 0) {
            candidates = candidatesSwap;
            dateFrom = dateFromSwap;
            dateTo = dateToSwap;
            dateUsed = swapped;
            dateCorrected = true;
          }
        }
      }

      const best =
        candidates.length === 0
          ? null
          : candidates.reduce((a, b) =>
              Math.abs(toAmountNum(a) - ext.amount) <= Math.abs(toAmountNum(b) - ext.amount) ? a : b
            );

      const matched_entry = best
        ? {
            id: best.id,
            amount: toAmountNum(best),
            date: best.date,
            category_name: best.category?.name?.trim() ?? '',
            merchant: best.merchant,
          }
        : null;

      return {
        sheet_index: i,
        amount: ext.amount,
        currency: ext.currency,
        date: dateUsed,
        time: ext.time ?? null,
        category_name: ext.suggested_category ?? 'Other',
        merchant: ext.merchant,
        source_snippet: ext.source_snippet ?? null,
        matched_entry_id: best?.id ?? null,
        matched_entry,
      };
    });

    res.json({ items });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to extract or match from image',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});

/**
 * POST /v1/import/sms-merge-confirm
 * Body: { items: Array<{ sheet_index, action: 'skip' | 'add_new' | 'discard', matched_entry_id?, category_id?, tag_ids?, ... }> }
 * discard: ignored. add_new: create transaction (category_id override, tag_ids). skip: optional tag_ids applied to matched_entry_id.
 */
importRouter.post('/sms-merge-confirm', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(422).json({ error: 'items array is required' });
      return;
    }
    console.log('[SMS-MERGE-CONFIRM] Received body.items (first 3):', JSON.stringify((items as unknown[]).slice(0, 3), null, 2));

    const toCreate = items.filter((x: { action?: string }) => x.action === 'add_new') as Array<{
      sheet_index: number;
      action: string;
      amount?: number;
      currency?: string;
      date?: string;
      time?: string;
      merchant?: string | null;
      suggested_category?: string | null;
      category_name?: string | null;
      category_id?: string | null;
      tag_ids?: string[];
    }>;
    const toTagMatched = items.filter(
      (x: { action?: string; matched_entry_id?: string; tag_ids?: string[] }) =>
        x.action === 'skip' && x.matched_entry_id && Array.isArray(x.tag_ids) && x.tag_ids.length > 0
    ) as Array<{ matched_entry_id: string; tag_ids: string[] }>;

    const validTagIds = await prisma.tag.findMany({
      where: { userId },
      select: { id: true },
    });
    const validTagIdSet = new Set(validTagIds.map((t) => t.id));

    const created: { id: string; amount: number; currency: string; date: string; time: string; merchant: string | null }[] = [];
    let skipped = 0;
    const region = await getRegionForUser(userId);

    for (const row of toCreate) {
      const amount = Number(row.amount);
      const dateNorm = normalizeDateToYYYYMMDD(row.date);
      if (Number.isNaN(amount) || !dateNorm) continue;

      const merchantNorm =
        row.merchant != null && String(row.merchant).trim() !== ''
          ? String(row.merchant).trim().slice(0, 200)
          : null;

      const existing = await prisma.transaction.findFirst({
        where: { userId, amount, date: dateNorm, merchant: merchantNorm },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      let categoryId: string | null = null;
      if (row.category_id && typeof row.category_id === 'string') {
        const cat = await prisma.category.findFirst({
          where: { id: row.category_id, userId },
          select: { id: true },
        });
        if (cat) categoryId = cat.id;
      }
      if (!categoryId) {
        const categoryName = (row.suggested_category ?? row.category_name ?? '') && String(row.suggested_category ?? row.category_name).trim();
        categoryId = await findCategoryIdByName(userId, categoryName);
        if (!categoryId && categoryName) {
          categoryId = await findOrCreateCategoryByName(userId, categoryName.slice(0, 80));
        }
        if (!categoryId) {
          categoryId = await suggestCategory(userId, merchantNorm ?? '', null, region);
        }
        if (!categoryId) {
          categoryId = await getFirstCategoryId(userId);
        }
        if (!categoryId) {
          await ensureDefaultCategories(userId);
          categoryId = await getFirstCategoryId(userId);
        }
      }
      if (!categoryId) continue;

      const currencyRaw = row.currency != null ? String(row.currency).trim().toUpperCase().slice(0, 3) : '';
      const currency = currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'EGP';
      const timeStr = row.time != null ? String(row.time).trim().slice(0, 20) : null;
      const tagIds = Array.isArray(row.tag_ids) ? row.tag_ids.filter((id) => validTagIdSet.has(id)) : [];
      let egpVal: Decimal | null = null;
      if (currency !== 'EGP') {
        const converted = await amountToEgp(currency, amount);
        if (converted != null) egpVal = new Decimal(converted);
        console.log('[SMS-MERGE-CONFIRM] Create row:', {
          row_currency: row.currency,
          currencyRaw,
          currency,
          amount,
          egpValue: egpVal != null ? Number(egpVal) : null,
        });
      } else {
        console.log('[SMS-MERGE-CONFIRM] Create row (EGP, no conversion):', { row_currency: row.currency, currencyRaw, currency, amount });
      }

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          amount,
          currency,
          egpValue: egpVal ?? undefined,
          categoryId,
          date: dateNorm,
          time: timeStr,
          merchant: merchantNorm,
          source: 'sms',
          tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
      });

      created.push({
        id: transaction.id,
        amount: Number(transaction.amount),
        currency: transaction.currency,
        date: transaction.date,
        time: transaction.time ?? '',
        merchant: transaction.merchant,
      });
    }

    for (const item of toTagMatched) {
      const tagIds = item.tag_ids.filter((id) => validTagIdSet.has(id));
      if (tagIds.length === 0) continue;
      const tx = await prisma.transaction.findFirst({
        where: { id: item.matched_entry_id, userId },
        include: { tags: { select: { tagId: true } } },
      });
      if (!tx) continue;
      const existingTagIds = tx.tags.map((t) => t.tagId);
      const merged = [...new Set([...existingTagIds, ...tagIds])];
      await prisma.transactionTag.deleteMany({ where: { transactionId: tx.id } });
      if (merged.length > 0) {
        await prisma.transactionTag.createMany({
          data: merged.map((tagId) => ({ transactionId: tx.id, tagId })),
          skipDuplicates: true,
        });
      }
    }

    const discarded = items.filter((x: { action?: string }) => x.action === 'discard').length;
    res.json({
      created,
      count: created.length,
      skipped,
      discarded,
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to create transactions from SMS',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});

/**
 * POST /v1/import/voice-merge-confirm
 * Same body as sms-merge-confirm; creates transactions with source: 'voice'.
 */
importRouter.post('/voice-merge-confirm', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(422).json({ error: 'items array is required' });
      return;
    }

    const toCreate = items.filter((x: { action?: string }) => x.action === 'add_new') as Array<{
      sheet_index: number;
      action: string;
      amount?: number;
      currency?: string;
      date?: string;
      time?: string;
      merchant?: string | null;
      suggested_category?: string | null;
      category_name?: string | null;
      category_id?: string | null;
      tag_ids?: string[];
    }>;
    const toTagMatched = items.filter(
      (x: { action?: string; matched_entry_id?: string; tag_ids?: string[] }) =>
        x.action === 'skip' && x.matched_entry_id && Array.isArray(x.tag_ids) && x.tag_ids.length > 0
    ) as Array<{ matched_entry_id: string; tag_ids: string[] }>;

    const validTagIds = await prisma.tag.findMany({
      where: { userId },
      select: { id: true },
    });
    const validTagIdSet = new Set(validTagIds.map((t) => t.id));

    const created: { id: string; amount: number; currency: string; date: string; time: string; merchant: string | null }[] = [];
    let skipped = 0;
    const region = await getRegionForUser(userId);

    for (const row of toCreate) {
      const amount = Number(row.amount);
      const dateNorm = normalizeDateToYYYYMMDD(row.date);
      if (Number.isNaN(amount) || !dateNorm) continue;

      const merchantNorm =
        row.merchant != null && String(row.merchant).trim() !== ''
          ? String(row.merchant).trim().slice(0, 200)
          : null;

      const existing = await prisma.transaction.findFirst({
        where: { userId, amount, date: dateNorm, merchant: merchantNorm },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      let categoryId: string | null = null;
      if (row.category_id && typeof row.category_id === 'string') {
        const cat = await prisma.category.findFirst({
          where: { id: row.category_id, userId },
          select: { id: true },
        });
        if (cat) categoryId = cat.id;
      }
      if (!categoryId) {
        const categoryName = (row.suggested_category ?? row.category_name ?? '') && String(row.suggested_category ?? row.category_name).trim();
        categoryId = await findCategoryIdByName(userId, categoryName);
        if (!categoryId && categoryName) {
          categoryId = await findOrCreateCategoryByName(userId, categoryName.slice(0, 80));
        }
        if (!categoryId) {
          categoryId = await suggestCategory(userId, merchantNorm ?? '', null, region);
        }
        if (!categoryId) {
          categoryId = await getFirstCategoryId(userId);
        }
        if (!categoryId) {
          await ensureDefaultCategories(userId);
          categoryId = await getFirstCategoryId(userId);
        }
      }
      if (!categoryId) continue;

      const currencyRaw = row.currency != null ? String(row.currency).trim().toUpperCase().slice(0, 3) : '';
      const currency = currencyRaw && /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : 'EGP';
      const timeStr = row.time != null ? String(row.time).trim().slice(0, 20) : null;
      const tagIds = Array.isArray(row.tag_ids) ? row.tag_ids.filter((id) => validTagIdSet.has(id)) : [];
      let egpVal: Decimal | null = null;
      if (currency !== 'EGP') {
        const converted = await amountToEgp(currency, amount);
        if (converted != null) egpVal = new Decimal(converted);
      }

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          amount,
          currency,
          egpValue: egpVal ?? undefined,
          categoryId,
          date: dateNorm,
          time: timeStr,
          merchant: merchantNorm,
          source: 'voice',
          tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
      });

      created.push({
        id: transaction.id,
        amount: Number(transaction.amount),
        currency: transaction.currency,
        date: transaction.date,
        time: transaction.time ?? '',
        merchant: transaction.merchant,
      });
    }

    for (const item of toTagMatched) {
      const tagIds = item.tag_ids.filter((id) => validTagIdSet.has(id));
      if (tagIds.length === 0) continue;
      const tx = await prisma.transaction.findFirst({
        where: { id: item.matched_entry_id, userId },
        include: { tags: { select: { tagId: true } } },
      });
      if (!tx) continue;
      const existingTagIds = tx.tags.map((t) => t.tagId);
      const merged = [...new Set([...existingTagIds, ...tagIds])];
      await prisma.transactionTag.deleteMany({ where: { transactionId: tx.id } });
      if (merged.length > 0) {
        await prisma.transactionTag.createMany({
          data: merged.map((tagId) => ({ transactionId: tx.id, tagId })),
          skipDuplicates: true,
        });
      }
    }

    const discarded = items.filter((x: { action?: string }) => x.action === 'discard').length;
    res.json({
      created,
      count: created.length,
      skipped,
      discarded,
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to create transactions from voice',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});

async function getFirstCategoryId(userId: string): Promise<string | null> {
  const c = await prisma.category.findFirst({
    where: { userId },
    select: { id: true },
  });
  return c?.id ?? null;
}

async function getRegionForUser(userId: string): Promise<string> {
  const s = await prisma.userSettings.findUnique({
    where: { userId },
    select: { locale: true },
  });
  if (s?.locale === 'ar-EG' || s?.locale?.toLowerCase().includes('eg')) return 'EG';
  if (s?.locale?.toLowerCase().includes('sa')) return 'SA';
  if (s?.locale?.toLowerCase().includes('ae')) return 'AE';
  return 'EG';
}

/** Find category id by name (case-insensitive). */
async function findCategoryIdByName(userId: string, name: string): Promise<string | null> {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true, nameAr: true },
  });
  const match = categories.find(
    (c) =>
      c.name.trim().toLowerCase() === normalized ||
      (c.nameAr != null && c.nameAr.trim().toLowerCase() === normalized)
  );
  return match?.id ?? null;
}

/** Find or create category by name. */
async function findOrCreateCategoryByName(userId: string, name: string): Promise<string | null> {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return null;
  const existing = await findCategoryIdByName(userId, trimmed);
  if (existing) return existing;
  const maxOrder = await prisma.category.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });
  const newCategory = await prisma.category.create({
    data: {
      userId,
      name: trimmed,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      isSystem: false,
    },
  });
  return newCategory.id;
}

/**
 * POST /v1/import/sheet-merge-confirm
 * Body: { items: Array<{ sheet_index, action: 'skip' | 'add_new' | 'discard', matched_entry_id?, category_id?, tag_ids?, ... }> }
 * discard: ignored. add_new: create transaction (category_id override, tag_ids). skip: optional tag_ids applied to matched_entry_id.
 */
importRouter.post('/sheet-merge-confirm', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(422).json({ error: 'items array is required' });
      return;
    }

    const toCreate = items.filter(
      (x: { action?: string }) => x.action === 'add_new'
    ) as Array<{
      sheet_index: number;
      action: string;
      amount?: number;
      date?: string;
      category_name?: string;
      merchant?: string | null;
      currency?: string;
      category_id?: string | null;
      tag_ids?: string[];
    }>;
    const toTagMatched = items.filter(
      (x: { action?: string; matched_entry_id?: string; tag_ids?: string[] }) =>
        x.action === 'skip' && x.matched_entry_id && Array.isArray(x.tag_ids) && x.tag_ids.length > 0
    ) as Array<{ matched_entry_id: string; tag_ids: string[] }>;

    const validTagIds = await prisma.tag.findMany({
      where: { userId },
      select: { id: true },
    });
    const validTagIdSet = new Set(validTagIds.map((t) => t.id));

    const created: { id: string; amount: number; date: string; merchant: string | null }[] = [];
    let skipped = 0;

    for (const row of toCreate) {
      const amount = Number(row.amount);
      const date = normalizeDateToYYYYMMDD(row.date);
      if (Number.isNaN(amount) || !date) continue;

      const merchantNorm =
        row.merchant != null && String(row.merchant).trim() !== ''
          ? String(row.merchant).trim().slice(0, 200)
          : null;

      const existing = await prisma.transaction.findFirst({
        where: {
          userId,
          amount,
          date,
          merchant: merchantNorm,
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      let categoryId: string | null = null;
      if (row.category_id && typeof row.category_id === 'string') {
        const cat = await prisma.category.findFirst({
          where: { id: row.category_id, userId },
          select: { id: true },
        });
        if (cat) categoryId = cat.id;
      }
      if (!categoryId) {
        const categoryName = (row.category_name && String(row.category_name).trim()) || 'Other';
        categoryId = await findOrCreateCategoryByName(userId, categoryName);
      }
      if (!categoryId) continue;

      const currency = (row.currency && String(row.currency).toUpperCase().slice(0, 3)) || 'EGP';
      const tagIds = Array.isArray(row.tag_ids) ? row.tag_ids.filter((id) => validTagIdSet.has(id)) : [];
      let egpVal: Decimal | null = null;
      if (currency !== 'EGP') {
        const converted = await amountToEgp(currency, amount);
        if (converted != null) egpVal = new Decimal(converted);
      }

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          amount,
          currency,
          egpValue: egpVal ?? undefined,
          categoryId,
          date,
          time: null,
          merchant: merchantNorm,
          source: 'manual',
          tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        },
      });

      created.push({
        id: transaction.id,
        amount: Number(transaction.amount),
        date: transaction.date,
        merchant: transaction.merchant,
      });
    }

    for (const item of toTagMatched) {
      const tagIds = item.tag_ids.filter((id) => validTagIdSet.has(id));
      if (tagIds.length === 0) continue;
      const tx = await prisma.transaction.findFirst({
        where: { id: item.matched_entry_id, userId },
        include: { tags: { select: { tagId: true } } },
      });
      if (!tx) continue;
      const existingTagIds = tx.tags.map((t) => t.tagId);
      const merged = [...new Set([...existingTagIds, ...tagIds])];
      await prisma.transactionTag.deleteMany({ where: { transactionId: tx.id } });
      if (merged.length > 0) {
        await prisma.transactionTag.createMany({
          data: merged.map((tagId) => ({ transactionId: tx.id, tagId })),
          skipDuplicates: true,
        });
      }
    }

    const minDate = created.length > 0 ? created.reduce((a, c) => (c.date < a ? c.date : a), created[0].date) : null;
    const maxDate = created.length > 0 ? created.reduce((a, c) => (c.date > a ? c.date : a), created[0].date) : null;

    const totalInDb = await prisma.transaction.count({ where: { userId } });
    const sampleIds = created.slice(0, 5).map((c) => c.id);
    const sampleFromDb = await prisma.transaction.findMany({
      where: { id: { in: sampleIds }, userId },
      select: { id: true, date: true, amount: true },
    });
    const sampleDates = sampleFromDb.map((t) => t.date);

    if (toCreate.length > 0) {
      const firstInputDates = toCreate.slice(0, 3).map((r) => ({ raw: r.date, normalized: normalizeDateToYYYYMMDD(r.date) }));
      console.log('Import: first 3 row.date inputs', JSON.stringify(firstInputDates));
    }
    const discarded = items.filter((x: { action?: string }) => x.action === 'discard').length;
    console.log(`Import: userId=${userId} created=${created.length} total_in_db=${totalInDb} date_range=${minDate}..${maxDate} sample_dates=${sampleDates.join(', ')}`);

    res.json({
      created,
      count: created.length,
      skipped,
      discarded,
      date_range: minDate && maxDate ? { min_date: minDate, max_date: maxDate } : null,
      total_transactions_for_user: totalInDb,
      sample_dates_from_db: sampleDates,
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to create transactions',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});

/** Shape of full export payload from GET /v1/users/export */
type ExportPayload = {
  version?: number;
  exportedAt?: string;
  user?: { id?: string; email?: string; createdAt?: string };
  userSettings?: {
    id?: string;
    userId?: string;
    defaultCurrency?: string;
    locale?: string;
    setupCompletedAt?: string | null;
    inboundEmailLocal?: string | null;
  } | null;
  categories?: Array<{
    id: string;
    userId?: string;
    parentId?: string | null;
    name: string;
    nameAr?: string | null;
    icon?: string | null;
    color?: string | null;
    isSystem?: boolean;
    sortOrder?: number;
  }>;
  tags?: Array<{
    id: string;
    userId?: string;
    name: string;
    nameAr?: string | null;
    color?: string | null;
  }>;
  budgets?: Array<{
    id: string;
    userId?: string;
    scopeType: string;
    scopeId?: string | null;
    amount: number;
    currency?: string;
    month: string;
  }>;
  transactions?: Array<{
    id: string;
    userId?: string;
    amount: number;
    currency?: string;
    egpValue?: number | null;
    categoryId: string;
    date: string;
    time?: string | null;
    locationTile?: string | null;
    locationVenueHint?: string | null;
    merchant?: string | null;
    source?: string;
    userConfirmedAt?: string | null;
    createdAt?: string;
    tagIds?: string[];
  }>;
};

/**
 * POST /v1/import/data
 * Body: full export JSON (from GET /v1/users/export).
 * Replaces all current user data with the imported data (categories, tags, budgets, transactions, settings).
 * Does not import ingest token; user can regenerate in Settings.
 */
importRouter.post('/data', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const body = req.body as ExportPayload;

    if (!body || typeof body !== 'object') {
      res.status(422).json({ error: 'Invalid export payload' });
      return;
    }

    const categories = Array.isArray(body.categories) ? body.categories : [];
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const budgets = Array.isArray(body.budgets) ? body.budgets : [];
    const transactions = Array.isArray(body.transactions) ? body.transactions : [];

    const categoryIds = new Set(categories.map((c) => c.id));
    const tagIds = new Set(tags.map((t) => t.id));

    await prisma.$transaction(async (tx) => {
      await tx.transactionTag.deleteMany({
        where: { transaction: { userId } },
      });
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.budget.deleteMany({ where: { userId } });
      await tx.tag.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });
      await tx.userSettings.deleteMany({ where: { userId } });

      if (body.userSettings && typeof body.userSettings === 'object') {
        await tx.userSettings.create({
          data: {
            userId,
            defaultCurrency: (body.userSettings.defaultCurrency && String(body.userSettings.defaultCurrency).slice(0, 10)) || 'EGP',
            locale: (body.userSettings.locale && String(body.userSettings.locale).slice(0, 20)) || 'en',
            setupCompletedAt: body.userSettings.setupCompletedAt
              ? new Date(body.userSettings.setupCompletedAt)
              : null,
            inboundEmailLocal:
              body.userSettings.inboundEmailLocal != null && String(body.userSettings.inboundEmailLocal).trim() !== ''
                ? String(body.userSettings.inboundEmailLocal).trim().slice(0, 100)
                : null,
          },
        });
      }

      for (const c of categories) {
        if (!c.id || !c.name) continue;
        await tx.category.create({
          data: {
            id: c.id,
            userId,
            parentId: c.parentId && categoryIds.has(c.parentId) ? c.parentId : null,
            name: c.name.slice(0, 200),
            nameAr: c.nameAr != null ? c.nameAr.slice(0, 200) : null,
            icon: c.icon != null ? c.icon.slice(0, 100) : null,
            color: c.color != null ? c.color.slice(0, 50) : null,
            isSystem: Boolean(c.isSystem),
            sortOrder: Number(c.sortOrder) || 0,
          },
        });
      }

      for (const t of tags) {
        if (!t.id || !t.name) continue;
        await tx.tag.create({
          data: {
            id: t.id,
            userId,
            name: t.name.slice(0, 100),
            nameAr: t.nameAr != null ? t.nameAr.slice(0, 100) : null,
            color: t.color != null ? t.color.slice(0, 50) : null,
          },
        });
      }

      for (const b of budgets) {
        if (!b.id || !b.scopeType || !b.month) continue;
        const scopeId = b.scopeId != null && (categoryIds.has(b.scopeId) || tagIds.has(b.scopeId)) ? b.scopeId : null;
        await tx.budget.create({
          data: {
            id: b.id,
            userId,
            scopeType: b.scopeType.slice(0, 50),
            scopeId,
            amount: Number(b.amount) || 0,
            currency: (b.currency && String(b.currency).slice(0, 10)) || 'EGP',
            month: b.month.slice(0, 10),
          },
        });
      }

      for (const t of transactions) {
        if (!t.id || !t.categoryId || !categoryIds.has(t.categoryId) || !t.date) continue;
        const tagIdsForTx = Array.isArray(t.tagIds) ? t.tagIds.filter((id) => tagIds.has(id)) : [];
        const amount = Number(t.amount) || 0;
        const currency = (t.currency && String(t.currency).slice(0, 10)) || 'EGP';
        let egpVal: number | null = t.egpValue != null && !Number.isNaN(Number(t.egpValue)) ? Number(t.egpValue) : null;
        if (egpVal == null && currency !== 'EGP' && Number.isFinite(amount)) {
          const converted = await amountToEgp(currency, amount);
          if (converted != null) egpVal = converted;
        }
        await tx.transaction.create({
          data: {
            id: t.id,
            userId,
            amount,
            currency,
            egpValue: egpVal != null ? new Decimal(egpVal) : null,
            categoryId: t.categoryId,
            date: t.date.slice(0, 10),
            time: t.time != null ? String(t.time).slice(0, 30) : null,
            locationTile: t.locationTile != null ? String(t.locationTile).slice(0, 200) : null,
            locationVenueHint: t.locationVenueHint != null ? String(t.locationVenueHint).slice(0, 200) : null,
            merchant: t.merchant != null ? String(t.merchant).slice(0, 200) : null,
            source: (t.source && String(t.source).slice(0, 50)) || 'manual',
            userConfirmedAt: t.userConfirmedAt ? new Date(t.userConfirmedAt) : null,
            tags: tagIdsForTx.length > 0 ? { create: tagIdsForTx.map((tagId) => ({ tagId })) } : undefined,
          },
        });
      }
    });

    res.json({
      ok: true,
      imported: {
        categories: categories.length,
        tags: tags.length,
        budgets: budgets.length,
        transactions: transactions.length,
      },
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: message || 'Failed to import data',
      details: e instanceof Error ? e.stack : undefined,
    });
  }
});
