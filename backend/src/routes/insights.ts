import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const insightsRouter = Router();
insightsRouter.use(authMiddleware);

insightsRouter.get('/summary', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const from = req.query.from as string;
    const to = req.query.to as string;
    const groupBy = (req.query.group_by as string) || 'category';

    if (!from || !to) {
      res.status(422).json({ error: 'from and to (YYYY-MM-DD) are required' });
      return;
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: from, lte: to },
      },
      include: {
        category: { select: { id: true, name: true, nameAr: true, parentId: true } },
        tags: { include: { tag: { select: { id: true, name: true } } } },
      },
    });

    const groups = new Map<string, number>();

    for (const t of transactions) {
      const amt = Number(t.amount);
      let key: string;
      let label: string;

      switch (groupBy) {
        case 'category':
        case 'sub_category':
          key = t.categoryId;
          label = t.category.name;
          break;
        case 'tag':
          if (t.tags.length === 0) {
            key = '_untagged';
            label = 'Untagged';
          } else {
            for (const tt of t.tags) {
              const k = tt.tagId;
              groups.set(k, (groups.get(k) || 0) + amt);
            }
            continue;
          }
          break;
        case 'day':
          key = t.date;
          label = t.date;
          break;
        case 'week':
          key = getWeekKey(t.date);
          label = key;
          break;
        default:
          key = t.categoryId;
          label = t.category.name;
      }

      groups.set(key, (groups.get(key) || 0) + amt);
    }

    const summary = Array.from(groups.entries()).map(([key, total]) => ({
      key,
      total: Math.round(total * 100) / 100,
    }));

    res.json({ from, to, group_by: groupBy, summary });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

function monthRangeForMonth(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [start, end];
}

insightsRouter.get('/budget-status', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const month = (req.query.month as string) || getCurrentCalendarMonth();

    const budgets = await prisma.budget.findMany({
      where: { userId, month },
    });

    const [start, end] = monthRangeForMonth(month);
    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: start, lte: end },
      },
      include: { tags: true },
    });

    const totalSpent = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
    const byCategory = new Map<string, number>();
    const byTag = new Map<string, number>();
    for (const t of transactions) {
      const amt = Number(t.amount);
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + amt);
      for (const tt of t.tags) {
        byTag.set(tt.tagId, (byTag.get(tt.tagId) || 0) + amt);
      }
    }

    const status = budgets.map((b) => {
      const amount = Number(b.amount);
      const spent =
        b.scopeType === 'total_monthly'
          ? totalSpent
          : b.scopeId && (b.scopeType === 'tag' ? byTag.get(b.scopeId) : byCategory.get(b.scopeId)) || 0;
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

    res.json({ month, budget_status: status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get budget status' });
  }
});

insightsRouter.get('/budget-by-category', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const month = (req.query.month as string) || getCurrentCalendarMonth();

    const [start, end] = monthRangeForMonth(month);

    const [categories, budgets, transactions] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, parentId: true },
      }),
      prisma.budget.findMany({
        where: { userId, month, scopeType: { in: ['category', 'sub_category'] } },
      }),
      prisma.transaction.findMany({
        where: { userId, date: { gte: start, lte: end } },
        select: { categoryId: true, amount: true },
      }),
    ]);

    const budgetByCategory = new Map<string, number>();
    for (const b of budgets) {
      if (b.scopeId) {
        budgetByCategory.set(b.scopeId, Number(b.amount));
      }
    }

    const actualByCategory = new Map<string, number>();
    for (const t of transactions) {
      const amt = Number(t.amount);
      actualByCategory.set(t.categoryId, (actualByCategory.get(t.categoryId) || 0) + amt);
    }

    let totalBudget = 0;
    let totalActual = 0;

    const items = categories.map((cat) => {
      const budget = budgetByCategory.get(cat.id) || 0;
      const actual = Math.round((actualByCategory.get(cat.id) || 0) * 100) / 100;
      const difference = Math.round((budget - actual) * 100) / 100;
      totalBudget += budget;
      totalActual += actual;
      return {
        category_id: cat.id,
        category_name: cat.name,
        budget,
        actual,
        difference,
      };
    });

    const totalDifference = Math.round((totalBudget - totalActual) * 100) / 100;
    totalBudget = Math.round(totalBudget * 100) / 100;
    totalActual = Math.round(totalActual * 100) / 100;

    res.json({
      month,
      items,
      total_budget: totalBudget,
      total_actual: totalActual,
      total_difference: totalDifference,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get budget by category' });
  }
});

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getCurrentCalendarMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
