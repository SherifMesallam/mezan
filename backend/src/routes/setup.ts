import { Router } from 'express';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../lib/prisma';
import { normalizeDateToYYYYMMDD } from '../lib/date';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { amountToEgp } from '../services/exchange-rates';
import { extractTransactionsFromSMS } from '../services/sms-extract';
import { getLearningTransactionsForUser } from './ingest';

export const setupRouter = Router();
setupRouter.use(authMiddleware);

const EXAMPLE_CATEGORIES = [
  'Bills',
  'Food',
  'Shopping',
  'Transport',
  'Subscriptions',
  'Healthcare',
  'Education',
  'Entertainment',
  'Personal',
  'Other',
];

const EXAMPLE_TAGS = [
  'recurring',
  'work',
  'personal',
  'urgent',
  'refund',
];

/** GET /v1/setup/status – whether setup has been completed (for redirect and Settings link). */
setupRouter.get('/status', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { setupCompletedAt: true },
    });
    res.json({
      setup_completed_at: settings?.setupCompletedAt?.toISOString() ?? null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get setup status' });
  }
});

/** POST /v1/setup/complete – mark setup as completed. */
setupRouter.post('/complete', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, setupCompletedAt: new Date(), defaultCurrency: 'EGP', locale: 'en' },
      update: { setupCompletedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to complete setup' });
  }
});

/** GET /v1/setup/examples – example categories and tags for the wizard. */
setupRouter.get('/examples', async (_req: AuthRequest, res) => {
  res.json({ categories: EXAMPLE_CATEGORIES, tags: EXAMPLE_TAGS });
});

/** POST /v1/setup/preview-extract – extract transactions from pasted text without creating them. */
setupRouter.post('/preview-extract', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const rawText = typeof req.body?.raw_text === 'string' ? req.body.raw_text.trim() : '';
    if (!rawText) {
      res.status(422).json({ error: 'raw_text is required' });
      return;
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      res.status(501).json({ error: 'AI extraction not configured. Set OPENAI_API_KEY.' });
      return;
    }

    const userCategoryNames = await getUserCategoryNames(userId);
    const learningExamples = await getLearningTransactionsForUser(userId);

    const extracted = await extractTransactionsFromSMS(
      {
        apiKey,
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
        model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      },
      rawText,
      { userCategoryNames, learningExamples }
    );

    res.json({ transactions: extracted });
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message || 'Extraction failed' });
  }
});

/** POST /v1/setup/confirm-extracted – create transactions from wizard review and mark as user-confirmed. */
setupRouter.post('/confirm-extracted', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(422).json({ error: 'items array is required and must not be empty' });
      return;
    }

    const created: { id: string; amount: number; currency: string; date: string; merchant: string | null }[] = [];
    let skipped = 0;

    for (const row of items as Array<{
      amount: number;
      currency?: string;
      date: string;
      time?: string | null;
      merchant?: string | null;
      category_id: string;
      tag_ids?: string[];
    }>) {
      const amount = Number(row.amount);
      const category_id = row.category_id;
      const date = normalizeDateToYYYYMMDD(row.date);
      if (Number.isNaN(amount) || !category_id || !date) continue;

      const merchantNorm = row.merchant != null && String(row.merchant).trim() !== ''
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

      const category = await prisma.category.findFirst({
        where: { id: category_id, userId },
      });
      if (!category) continue;

      let tagIds = Array.isArray(row.tag_ids) ? row.tag_ids : [];
      if (tagIds.length > 0) {
        const userTags = await prisma.tag.findMany({
          where: { userId },
          select: { id: true },
        });
        const validIds = new Set(userTags.map((t) => t.id));
        tagIds = tagIds.filter((id: string) => validIds.has(id));
      }

      const currency = (row.currency || 'EGP').toString().toUpperCase().slice(0, 3) || 'EGP';
      let egpVal: Decimal | null = null;
      if (currency !== 'EGP' && Number.isFinite(amount)) {
        const converted = await amountToEgp(currency, amount);
        if (converted != null) egpVal = new Decimal(converted);
      }

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          amount,
          currency,
          egpValue: egpVal ?? undefined,
          categoryId: category_id,
          date,
          time: row.time != null ? String(row.time) : null,
          merchant: merchantNorm,
          source: 'sms',
          userConfirmedAt: new Date(),
          tags:
            tagIds.length > 0
              ? { create: tagIds.map((tagId: string) => ({ tagId })) }
              : undefined,
        },
      });

      created.push({
        id: transaction.id,
        amount: Number(transaction.amount),
        currency: transaction.currency,
        date: transaction.date,
        merchant: transaction.merchant,
      });
    }

    res.json({ created, count: created.length, skipped });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create transactions' });
  }
});

async function getUserCategoryNames(userId: string): Promise<string[]> {
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { name: true },
    orderBy: { sortOrder: 'asc' },
  });
  return categories.map((c) => c.name.trim()).filter(Boolean);
}
