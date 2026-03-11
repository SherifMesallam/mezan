import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { Decimal } from '@prisma/client/runtime/library';

export const budgetsRouter = Router();
budgetsRouter.use(authMiddleware);

budgetsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const month = (req.query.month as string) || getCurrentMonth();

    await syncTotalMonthlyBudget(userId, month);

    const budgets = await prisma.budget.findMany({
      where: { userId, month },
    });

    const spentByScope = await computeSpentByScope(userId, month);

    const list = budgets.map((b) => {
      const key = b.scopeType === 'total_monthly' ? 'total_monthly' : `${b.scopeType}:${b.scopeId}`;
      const spent = spentByScope.get(key) || 0;
      const amount = Number(b.amount);
      const remaining = Math.max(0, amount - spent);
      const overspent = spent > amount;

      return {
        id: b.id,
        scope_type: b.scopeType,
        scope_id: b.scopeId,
        amount,
        currency: b.currency,
        month: b.month,
        spent,
        remaining,
        overspent,
      };
    });

    res.json({ budgets: list, month });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list budgets' });
  }
});

budgetsRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { scope_type, scope_id, amount, currency, month } = req.body as {
      scope_type: string;
      scope_id?: string | null;
      amount: number;
      currency?: string;
      month?: string;
    };

    if (!scope_type || amount == null) {
      res.status(422).json({ error: 'scope_type and amount are required' });
      return;
    }
    const validScopes = ['total_monthly', 'category', 'sub_category', 'tag'];
    if (!validScopes.includes(scope_type)) {
      res.status(422).json({ error: 'Invalid scope_type' });
      return;
    }
    if (scope_type !== 'total_monthly' && !scope_id) {
      res.status(422).json({ error: 'scope_id required when scope_type is not total_monthly' });
      return;
    }

    const monthStr = month ? String(month).slice(0, 7) : getCurrentMonth();
    const cur = (currency || 'EGP').toUpperCase();

    if (scope_type === 'category' || scope_type === 'sub_category') {
      const cat = await prisma.category.findFirst({ where: { id: scope_id!, userId } });
      if (!cat) {
        res.status(422).json({ error: 'Category not found' });
        return;
      }
    }
    if (scope_type === 'tag') {
      const tag = await prisma.tag.findFirst({ where: { id: scope_id!, userId } });
      if (!tag) {
        res.status(422).json({ error: 'Tag not found' });
        return;
      }
    }

    let budget;
    if (scope_type === 'total_monthly' && (scope_id === undefined || scope_id === null)) {
      const existing = await prisma.budget.findFirst({
        where: { userId, scopeType: 'total_monthly', month: monthStr, scopeId: null },
      });
      if (existing) {
        budget = await prisma.budget.update({
          where: { id: existing.id },
          data: { amount: new Decimal(amount), currency: cur },
        });
      } else {
        budget = await prisma.budget.create({
          data: {
            userId,
            scopeType: scope_type,
            scopeId: null,
            amount: new Decimal(amount),
            currency: cur,
            month: monthStr,
          },
        });
      }
    } else {
      const scope_id_val = scope_id!;
      budget = await prisma.budget.upsert({
        where: {
          userId_scopeType_scopeId_month: {
            userId,
            scopeType: scope_type,
            scopeId: scope_id_val,
            month: monthStr,
          },
        },
        create: {
          userId,
          scopeType: scope_type,
          scopeId: scope_id_val,
          amount: new Decimal(amount),
          currency: cur,
          month: monthStr,
        },
        update: {
          amount: new Decimal(amount),
          currency: cur,
        },
      });
    }

    if (scope_type === 'category' || scope_type === 'sub_category' || scope_type === 'total_monthly') {
      await syncTotalMonthlyBudget(userId, monthStr);
    }

    res.status(201).json({
      id: budget.id,
      scope_type: budget.scopeType,
      scope_id: budget.scopeId,
      amount: Number(budget.amount),
      currency: budget.currency,
      month: budget.month,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to set budget' });
  }
});

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Set total_monthly budget for this user+month to the sum of all category and sub_category budgets.
 * Call after any budget change and when listing so total always equals sum of category budgets.
 */
async function syncTotalMonthlyBudget(userId: string, month: string): Promise<void> {
  const categoryBudgets = await prisma.budget.findMany({
    where: {
      userId,
      month,
      scopeType: { in: ['category', 'sub_category'] },
    },
    select: { amount: true },
  });
  const sum = categoryBudgets.reduce((s, b) => s + Number(b.amount), 0);
  const total = Math.round(sum * 100) / 100;

  const existing = await prisma.budget.findFirst({
    where: { userId, scopeType: 'total_monthly', month, scopeId: null },
  });
  if (existing) {
    await prisma.budget.update({
      where: { id: existing.id },
      data: { amount: new Decimal(total) },
    });
  } else {
    await prisma.budget.create({
      data: {
        userId,
        scopeType: 'total_monthly',
        scopeId: null,
        amount: new Decimal(total),
        currency: 'EGP',
        month,
      },
    });
  }
}

async function computeSpentByScope(
  userId: string,
  month: string
): Promise<Map<string, number>> {
  const [start, end] = monthRange(month);
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: start, lte: end },
    },
    include: { tags: true, category: true },
  });

  const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const byCategory = new Map<string, number>();
  const byTag = new Map<string, number>();

  for (const t of transactions) {
    const amt = Number(t.amount);
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + amt);
    for (const tt of t.tags) {
      byTag.set(tt.tagId, (byTag.get(tt.tagId) || 0) + amt);
    }
  }

  const result = new Map<string, number>();
  result.set('total_monthly', total);
  for (const [id, sum] of byCategory) result.set(`category:${id}`, sum);
  for (const [id, sum] of byCategory) result.set(`sub_category:${id}`, sum);
  for (const [id, sum] of byTag) result.set(`tag:${id}`, sum);
  return result;
}

function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [start, end];
}
