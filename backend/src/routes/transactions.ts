import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { normalizeDateToYYYYMMDD } from '../lib/date';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { recordCategoryFeedback } from '../services/learning';
import { Decimal } from '@prisma/client/runtime/library';

const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const transactionsRouter = Router();
transactionsRouter.use(authMiddleware);

transactionsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const fromRaw = req.query.from as string | undefined;
    const toRaw = req.query.to as string | undefined;
    const from = typeof fromRaw === 'string' ? fromRaw.trim().slice(0, 10) : undefined;
    const to = typeof toRaw === 'string' ? toRaw.trim().slice(0, 10) : undefined;
    const categoryId = req.query.category_id as string | undefined;
    const tagId = req.query.tag_id as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 2000);

    const where: { userId: string; date?: { gte?: string; lte?: string }; categoryId?: string; tags?: { some: { tagId: string } } } = {
      userId,
    };
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) where.date = { ...where.date, gte: from };
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) where.date = { ...where.date, lte: to };
    if (categoryId) where.categoryId = categoryId;
    if (tagId) where.tags = { some: { tagId } };

    const [transactions, totalCount] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: limit,
        include: {
          category: { select: { id: true, name: true, nameAr: true, parentId: true } },
          tags: { include: { tag: { select: { id: true, name: true, nameAr: true } } } },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    const list = transactions.map((t) => ({
      id: t.id,
      amount: Number(t.amount),
      currency: t.currency,
      egp_value: t.egpValue != null ? Number(t.egpValue) : null,
      category_id: t.categoryId,
      category: t.category,
      date: t.date,
      time: t.time,
      location_tile: t.locationTile,
      location_venue_hint: t.locationVenueHint,
      merchant: t.merchant,
      source: t.source,
      created_at: t.createdAt,
      tag_ids: t.tags.map((tt) => tt.tag.id),
      tags: t.tags.map((tt) => tt.tag),
    }));

    res.json({ transactions: list, total_count: totalCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list transactions' });
  }
});

/**
 * GET /v1/transactions/date-range
 * Returns the min/max transaction dates and total count for the current user (no date filter).
 * Used so the UI can show "Your data spans X to Y" when viewing a month with no results.
 */
transactionsRouter.get('/date-range', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const agg = await prisma.transaction.aggregate({
      where: { userId },
      _min: { date: true },
      _max: { date: true },
      _count: true,
    });
    const min_date = agg._min.date ?? null;
    const max_date = agg._max.date ?? null;
    res.json({
      min_date,
      max_date,
      total_count: agg._count,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get date range' });
  }
});

/**
 * POST /v1/transactions/fix-dates
 * Normalizes all transaction dates for the current user to YYYY-MM-DD.
 * Use this if transactions exist in the DB but don't appear in lists/charts (wrong date format).
 */
transactionsRouter.post('/fix-dates', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const all = await prisma.transaction.findMany({
      where: { userId },
      select: { id: true, date: true, createdAt: true },
    });
    let updated = 0;
    let skipped = 0;
    for (const t of all) {
      const trimmed = String(t.date).trim();
      let targetDate: string | null = null;

      if (!VALID_DATE_REGEX.test(trimmed)) {
        targetDate = normalizeDateToYYYYMMDD(trimmed);
      } else if (trimmed === '1970-01-01') {
        const fallback = t.createdAt.toISOString().slice(0, 10);
        if (fallback && /^\d{4}-\d{2}-\d{2}$/.test(fallback)) targetDate = fallback;
      }

      if (!targetDate || targetDate === t.date) {
        skipped += 1;
        continue;
      }
      await prisma.transaction.update({
        where: { id: t.id },
        data: { date: targetDate },
      });
      updated += 1;
    }
    res.json({ updated, skipped, total_checked: all.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fix transaction dates' });
  }
});

transactionsRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const {
      amount,
      currency,
      egp_value,
      category_id,
      date,
      time,
      tag_ids,
      location_tile,
      merchant,
      source,
    } = req.body as {
      amount: number;
      currency?: string;
      egp_value?: number | null;
      category_id: string;
      date: string;
      time?: string;
      tag_ids?: string[];
      location_tile?: string;
      merchant?: string;
      source?: string;
    };

    if (amount == null || !category_id || !date) {
      res.status(422).json({ error: 'amount, category_id, and date are required' });
      return;
    }

    const category = await prisma.category.findFirst({
      where: { id: category_id, userId },
    });
    if (!category) {
      res.status(422).json({ error: 'Category not found' });
      return;
    }

    const cur = (currency || 'EGP').toUpperCase();
    const dateStr = normalizeDateToYYYYMMDD(date) || String(date).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(422).json({ error: 'Invalid date; use YYYY-MM-DD or a parseable date' });
      return;
    }

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        amount: Number(amount),
        currency: cur,
        egpValue: egp_value != null && egp_value !== '' ? new Decimal(Number(egp_value)) : null,
        categoryId: category_id,
        date: dateStr,
        time: time != null ? String(time) : null,
        locationTile: location_tile != null ? String(location_tile) : null,
        merchant: merchant != null ? String(merchant) : null,
        source: source || 'manual',
        tags:
          Array.isArray(tag_ids) && tag_ids.length > 0
            ? { create: tag_ids.map((tagId) => ({ tagId })) }
            : undefined,
      },
      include: {
        category: { select: { id: true, name: true, nameAr: true } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
    });

    res.status(201).json({
      id: transaction.id,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      egp_value: transaction.egpValue != null ? Number(transaction.egpValue) : null,
      category_id: transaction.categoryId,
      category: transaction.category,
      date: transaction.date,
      time: transaction.time,
      tag_ids: transaction.tags.map((tt) => tt.tag.id),
      tags: transaction.tags.map((tt) => tt.tag),
      merchant: transaction.merchant,
      source: transaction.source,
      created_at: transaction.createdAt,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

transactionsRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const id = req.params.id;
    const { category_id, tag_ids, date, time, amount, currency, egp_value, merchant, location_tile } = req.body;

    const existing = await prisma.transaction.findFirst({
      where: { id, userId },
      include: { tags: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    const data: Record<string, unknown> = {};
    let userConfirmed = false;
    if (category_id != null) {
      const cat = await prisma.category.findFirst({ where: { id: category_id, userId } });
      if (!cat) {
        res.status(422).json({ error: 'Category not found' });
        return;
      }
      data.categoryId = category_id;
      userConfirmed = true;
    }
    if (date != null) {
      const normalized = normalizeDateToYYYYMMDD(date);
      if (normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) data.date = normalized;
      else data.date = String(date).trim().slice(0, 10);
    }
    if (time !== undefined) data.time = time ? String(time) : null;
    if (amount != null) data.amount = Number(amount);
    if (currency != null) data.currency = String(currency).toUpperCase();
    if (egp_value !== undefined) data.egpValue = egp_value != null && egp_value !== '' ? new Decimal(Number(egp_value)) : null;
    if (merchant !== undefined) data.merchant = merchant ? String(merchant) : null;
    if (location_tile !== undefined) data.locationTile = location_tile ? String(location_tile) : null;

    if (tag_ids !== undefined && Array.isArray(tag_ids)) {
      userConfirmed = true;
      await prisma.transactionTag.deleteMany({ where: { transactionId: id } });
      if (tag_ids.length > 0) {
        await prisma.transactionTag.createMany({
          data: tag_ids.map((tagId: string) => ({ transactionId: id, tagId })),
          skipDuplicates: true,
        });
      }
    }
    if (userConfirmed) {
      data.userConfirmedAt = new Date();
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, name: true, nameAr: true } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
    });

    if (category_id != null && existing.merchant && existing.merchant.trim()) {
      const categoryName = updated.category.name;
      const region = await getRegionForUser(userId);
      recordCategoryFeedback({
        merchantNormalized: existing.merchant.trim().toLowerCase(),
        categoryName,
        region,
      }).catch((e) => console.error('Failed to record category feedback:', e));
    }

    res.json({
      id: updated.id,
      amount: Number(updated.amount),
      currency: updated.currency,
      egp_value: updated.egpValue != null ? Number(updated.egpValue) : null,
      category_id: updated.categoryId,
      category: updated.category,
      date: updated.date,
      time: updated.time,
      tag_ids: updated.tags.map((tt) => tt.tag.id),
      tags: updated.tags.map((tt) => tt.tag),
      merchant: updated.merchant,
      source: updated.source,
      created_at: updated.createdAt,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

transactionsRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const id = req.params.id;
    const existing = await prisma.transaction.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }
    await prisma.transaction.delete({ where: { id } });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

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
