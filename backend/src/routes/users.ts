import { Router } from 'express';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const usersRouter = Router();
usersRouter.use(authMiddleware);

usersRouter.get('/me', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });
    const inboundEmail = settings?.inboundEmailLocal
      ? `${settings.inboundEmailLocal}@inbound.mezan.app`
      : null;
    res.json({
      ...user,
      ingest_token: settings?.ingestTokenHash ? '••••••••' : null,
      inbound_email: inboundEmail,
      default_currency: settings?.defaultCurrency,
      locale: settings?.locale,
      setup_completed_at: settings?.setupCompletedAt?.toISOString() ?? null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

usersRouter.post('/me/ingest-token', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const rawToken = uuidv4() + '-' + uuidv4();
    const hash = await bcrypt.hash(rawToken, 10);
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ingestTokenHash: hash, defaultCurrency: 'EGP', locale: 'en' },
      update: { ingestTokenHash: hash },
    });
    res.json({ ingest_token: rawToken });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to rotate ingest token' });
  }
});

/** Decimal or number to number for JSON export */
function toNum(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (v != null && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
}

/**
 * GET /v1/users/export
 * Returns all user data as JSON (categories, tags, budgets, transactions, settings) for backup/import elsewhere.
 */
usersRouter.get('/export', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;

    const [user, userSettings, categories, tags, budgets, transactions] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, createdAt: true },
      }),
      prisma.userSettings.findUnique({ where: { userId } }),
      prisma.category.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } }),
      prisma.tag.findMany({ where: { userId } }),
      prisma.budget.findMany({ where: { userId } }),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { tags: { select: { tagId: true } } },
      }),
    ]);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const exportedAt = new Date().toISOString();
    const payload = {
      version: 1,
      exportedAt,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt != null && typeof (user.createdAt as Date).toISOString === 'function'
          ? (user.createdAt as Date).toISOString()
          : new Date().toISOString(),
      },
      userSettings: userSettings
        ? {
            id: userSettings.id,
            userId: userSettings.userId,
            ingestTokenHash: userSettings.ingestTokenHash,
            inboundEmailLocal: userSettings.inboundEmailLocal,
            defaultCurrency: userSettings.defaultCurrency,
            locale: userSettings.locale,
            setupCompletedAt:
              userSettings.setupCompletedAt != null && typeof (userSettings.setupCompletedAt as Date).toISOString === 'function'
                ? (userSettings.setupCompletedAt as Date).toISOString()
                : null,
          }
        : null,
      categories: categories.map((c) => ({
        id: c.id,
        userId: c.userId,
        parentId: c.parentId,
        name: c.name,
        nameAr: c.nameAr,
        icon: c.icon,
        color: c.color,
        isSystem: c.isSystem,
        sortOrder: c.sortOrder,
      })),
      tags: tags.map((t) => ({
        id: t.id,
        userId: t.userId,
        name: t.name,
        nameAr: t.nameAr,
        color: t.color,
      })),
      budgets: budgets.map((b) => ({
        id: b.id,
        userId: b.userId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
        amount: toNum(b.amount),
        currency: b.currency,
        month: b.month,
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        userId: t.userId,
        amount: toNum(t.amount),
        currency: t.currency,
        egpValue: t.egpValue != null ? toNum(t.egpValue) : null,
        categoryId: t.categoryId,
        date: t.date,
        time: t.time ?? null,
        locationTile: t.locationTile ?? null,
        locationVenueHint: t.locationVenueHint ?? null,
        merchant: t.merchant ?? null,
        source: t.source ?? 'manual',
        userConfirmedAt:
          t.userConfirmedAt != null && typeof (t.userConfirmedAt as Date).toISOString === 'function'
            ? (t.userConfirmedAt as Date).toISOString()
            : null,
        createdAt:
          t.createdAt != null && typeof (t.createdAt as Date).toISOString === 'function'
            ? (t.createdAt as Date).toISOString()
            : new Date().toISOString(),
        tagIds: Array.isArray(t.tags) ? t.tags.map((tt) => tt.tagId) : [],
      })),
    };

    res.json(payload);
  } catch (e) {
    console.error('Export error:', e);
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message || 'Failed to export data' });
  }
});
