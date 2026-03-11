import { Router } from 'express';
import { ingestAuthMiddleware, IngestRequest } from '../middleware/ingestAuth';
import { prisma } from '../lib/prisma';
import { normalizeDateToYYYYMMDD } from '../lib/date';
import { suggestCategory } from '../services/categorization';
import { extractTransactionsFromSMS, type LearningExample } from '../services/sms-extract';
import { ensureDefaultCategories } from '../lib/seedDefaultCategories';

export const ingestRouter = Router();

ingestRouter.post('/parsed', ingestAuthMiddleware, async (req: IngestRequest, res) => {
  try {
    const userId = req.ingestUserId!;
    const { amount, currency, date, time, anonymized_text, location_tile } = req.body as {
      amount?: number;
      currency?: string;
      date?: string;
      time?: string;
      anonymized_text?: string;
      location_tile?: string;
    };

    if (amount == null || String(amount) === '') {
      res.status(422).json({ error: 'amount is required' });
      return;
    }
    const parsedAmount = typeof amount === 'number' ? amount : parseFloat(amount);
    if (Number.isNaN(parsedAmount)) {
      res.status(422).json({ error: 'Invalid amount' });
      return;
    }

    const dateStr = date ? normalizeDateToYYYYMMDD(date) : new Date().toISOString().slice(0, 10);
    if (!dateStr) {
      res.status(422).json({ error: 'Invalid date' });
      return;
    }
    const cur = (currency || 'EGP').toUpperCase();
    const anonymizedText = anonymized_text != null ? String(anonymized_text) : '';
    const locTile = location_tile != null ? String(location_tile) : null;
    const timeStr = time != null ? String(time) : null;

    const region = await getRegionForUser(userId);
    const suggestedCategoryId = await suggestCategory(userId, anonymizedText, locTile, region);
    let categoryId = suggestedCategoryId || (await getFirstCategoryId(userId));
    if (!categoryId) {
      await ensureDefaultCategories(userId);
      categoryId = await getFirstCategoryId(userId);
    }
    if (!categoryId) {
      res.status(422).json({ error: 'No categories found; create at least one category first' });
      return;
    }

    const merchant =
      anonymizedText && !/\d/.test(anonymizedText) && anonymizedText.length < 200 ? anonymizedText.trim() : null;

    const existing = await prisma.transaction.findFirst({
      where: {
        userId,
        amount: parsedAmount,
        date: dateStr,
        merchant,
      },
    });
    if (existing) {
      res.status(409).json({
        error: 'A transaction with this amount, date and merchant already exists.',
        existing_id: existing.id,
      });
      return;
    }

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        amount: parsedAmount,
        currency: cur,
        categoryId,
        date: dateStr,
        time: timeStr,
        locationTile: locTile || null,
        merchant,
        source: 'sms',
      },
    });

    res.status(200).json({
      created: {
        id: transaction.id,
        amount: Number(transaction.amount),
        currency: transaction.currency,
        date: transaction.date,
        time: transaction.time,
        merchant: transaction.merchant,
        suggested_category_id: suggestedCategoryId,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create transaction from ingest' });
  }
});

/**
 * POST /v1/ingest/raw-sms
 * Body: { raw_text: string }
 * Uses LLM to extract one or more transactions from pasted text (single or multiple SMS messages).
 * Requires OPENAI_API_KEY. Falls back to 501 if not set.
 */
ingestRouter.post('/raw-sms', ingestAuthMiddleware, async (req: IngestRequest, res) => {
  try {
    const userId = req.ingestUserId!;
    const rawText = typeof req.body?.raw_text === 'string' ? req.body.raw_text.trim() : '';
    if (!rawText) {
      res.status(422).json({ error: 'raw_text is required' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      res.status(501).json({
        error: 'AI extraction not configured. Set OPENAI_API_KEY in backend .env.',
      });
      return;
    }

    const userCategoryNames = await getUserCategoryNames(userId);
    const learningExamples = await getLearningTransactionsForUser(userId);
    const extractedList = await extractTransactionsFromSMS(
      {
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      },
      rawText,
      { userCategoryNames, learningExamples }
    );

    if (extractedList.length === 0) {
      res.status(422).json({ error: 'Could not extract any transaction from the text. Check the message format.' });
      return;
    }

    const region = await getRegionForUser(userId);
    const created: { id: string; amount: number; currency: string; date: string; time: string; merchant: string | null; suggested_category: string | null }[] = [];
    let skipped = 0;

    for (const extracted of extractedList) {
      const merchantNorm =
        extracted.merchant != null && String(extracted.merchant).trim() !== ''
          ? String(extracted.merchant).trim().slice(0, 200)
          : null;
      const dateNorm = normalizeDateToYYYYMMDD(extracted.date);
      if (!dateNorm) continue;

      const existing = await prisma.transaction.findFirst({
        where: {
          userId,
          amount: extracted.amount,
          date: dateNorm,
          merchant: merchantNorm,
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      let categoryId: string | null = null;
      if (extracted.suggested_category) {
        categoryId = await findCategoryIdByName(userId, extracted.suggested_category);
      }
      if (!categoryId && extracted.suggested_category) {
        categoryId = await findOrCreateCategoryByName(userId, extracted.suggested_category);
      }
      if (!categoryId) {
        const anonymizedForCategory = extracted.merchant || '';
        categoryId = await suggestCategory(userId, anonymizedForCategory, null, region);
      }
      if (!categoryId) {
        categoryId = await getFirstCategoryId(userId);
      }
      if (!categoryId) {
        await ensureDefaultCategories(userId);
        categoryId = await getFirstCategoryId(userId);
      }
      if (!categoryId) {
        res.status(422).json({ error: 'No categories found; create at least one category first' });
        return;
      }

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          amount: extracted.amount,
          currency: extracted.currency,
          categoryId,
          date: dateNorm,
          time: extracted.time,
          merchant: merchantNorm,
          source: 'sms',
        },
      });

      created.push({
        id: transaction.id,
        amount: Number(transaction.amount),
        currency: transaction.currency,
        date: transaction.date,
        time: transaction.time ?? '',
        merchant: transaction.merchant,
        suggested_category: extracted.suggested_category,
      });
    }

    res.status(200).json({
      created,
      count: created.length,
      skipped,
    });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message || 'Failed to create transaction(s) from SMS' });
  }
});

async function getFirstCategoryId(userId: string): Promise<string | null> {
  const c = await prisma.category.findFirst({
    where: { userId },
    select: { id: true },
  });
  return c?.id ?? null;
}

/** Return list of category names for the user (for LLM prompt). */
async function getUserCategoryNames(userId: string): Promise<string[]> {
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { name: true },
    orderBy: { sortOrder: 'asc' },
  });
  return categories.map((c) => c.name.trim()).filter(Boolean);
}

/**
 * Transactions that reflect user choices: manual entries, any with tags, or user-confirmed (edited category/tags).
 * Used as few-shot examples so the LLM learns how this user categorizes and tags.
 */
export async function getLearningTransactionsForUser(userId: string, limit: number = 25): Promise<LearningExample[]> {
  const manual = await prisma.transaction.findMany({
    where: { userId, source: 'manual' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      category: { select: { name: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  });
  const withTags = await prisma.transaction.findMany({
    where: {
      userId,
      tags: { some: {} },
      id: { notIn: manual.map((t) => t.id) },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      category: { select: { name: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  });
  const userConfirmed = await prisma.transaction.findMany({
    where: {
      userId,
      userConfirmedAt: { not: null },
      id: { notIn: [...manual, ...withTags].map((t) => t.id) },
    },
    orderBy: { userConfirmedAt: 'desc' },
    take: limit,
    include: {
      category: { select: { name: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  });
  const seen = new Set<string>();
  const out: LearningExample[] = [];
  for (const t of [...manual, ...withTags, ...userConfirmed]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const category = t.category?.name?.trim() || '';
    const tags = (t.tags ?? []).map((tt) => tt.tag.name.trim()).filter(Boolean);
    if (category) {
      out.push({
        merchant: t.merchant?.trim() || null,
        category,
        tags,
      });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Find a category by name or nameAr (case-insensitive) for the user. */
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

/** Find category by name; if none, create one with that name and return its id. */
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
