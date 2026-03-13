import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { effectiveAmount } from '../lib/transaction';

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
      const amt = effectiveAmount(t);
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

    const totalSpent = transactions.reduce((sum, t) => sum + effectiveAmount(t), 0);
    const byCategory = new Map<string, number>();
    const byTag = new Map<string, number>();
    for (const t of transactions) {
      const amt = effectiveAmount(t);
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + amt);
      for (const tt of t.tags) {
        byTag.set(tt.tagId, (byTag.get(tt.tagId) || 0) + amt);
      }
    }

    const categoryIds = [...new Set(budgets.filter((b) => b.scopeId && (b.scopeType === 'category' || b.scopeType === 'sub_category')).map((b) => b.scopeId!))];
    const tagIds = [...new Set(budgets.filter((b) => b.scopeId && b.scopeType === 'tag').map((b) => b.scopeId!))];
    const categories = categoryIds.length > 0 ? await prisma.category.findMany({ where: { id: { in: categoryIds }, userId }, select: { id: true, name: true } }) : [];
    const tags = tagIds.length > 0 ? await prisma.tag.findMany({ where: { id: { in: tagIds }, userId }, select: { id: true, name: true } }) : [];
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
    const tagNames = new Map(tags.map((t) => [t.id, t.name]));

    const status = budgets.map((b) => {
      const amount = Number(b.amount);
      const spent =
        b.scopeType === 'total_monthly'
          ? totalSpent
          : b.scopeId && (b.scopeType === 'tag' ? byTag.get(b.scopeId) : byCategory.get(b.scopeId)) || 0;
      const remaining = Math.max(0, amount - spent);
      const overspent = spent > amount;
      let scope_name: string | null = null;
      if (b.scopeType === 'total_monthly') scope_name = 'Total';
      else if (b.scopeId && (b.scopeType === 'category' || b.scopeType === 'sub_category')) scope_name = categoryNames.get(b.scopeId) ?? null;
      else if (b.scopeId && b.scopeType === 'tag') scope_name = tagNames.get(b.scopeId) ?? null;

      return {
        id: b.id,
        scope_type: b.scopeType,
        scope_id: b.scopeId,
        scope_name,
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
    const rangeFrom = req.query.from as string;
    const rangeTo = req.query.to as string;

    const [start, end] =
      rangeFrom && rangeTo ? [rangeFrom, rangeTo] : monthRangeForMonth(month);

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
        select: { categoryId: true, amount: true, egpValue: true },
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
      const amt = effectiveAmount(t);
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

/**
 * GET /v1/insights/spending-patterns
 * Query: from, to (YYYY-MM-DD). Returns when you spend more (time of day, day of month), top vendor, top category.
 */
insightsRouter.get('/spending-patterns', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(422).json({ error: 'from and to (YYYY-MM-DD) are required' });
      return;
    }

    const [transactions, previousTransactions] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId, date: { gte: from, lte: to } },
        include: {
          category: { select: { id: true, name: true } },
        },
      }),
      (async () => {
        const fromDate = new Date(from + 'T12:00:00Z');
        const toDate = new Date(to + 'T12:00:00Z');
        const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
        const prevToDate = new Date(fromDate);
        prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);
        const prevFromDate = new Date(prevToDate);
        prevFromDate.setUTCDate(prevFromDate.getUTCDate() - days + 1);
        const prevFrom = prevFromDate.toISOString().slice(0, 10);
        const prevTo = prevToDate.toISOString().slice(0, 10);
        return prisma.transaction.findMany({
          where: { userId, date: { gte: prevFrom, lte: prevTo } },
          select: { amount: true, egpValue: true },
        });
      })(),
    ]);

    const byHour = new Map<number, number>();
    const byDayOfMonth = new Map<number, number>();
    const byDayOfWeek = new Map<number, number>();
    const byMerchant = new Map<string, number>();
    const byCategory = new Map<string, { name: string; amount: number }>();
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    let largest: { amount: number; date: string; merchant: string | null; category_name: string } | null = null;

    for (const t of transactions) {
      const amt = effectiveAmount(t);
      const hour = t.time ? parseHour(t.time) : 12;
      byHour.set(hour, (byHour.get(hour) ?? 0) + amt);
      const day = parseInt(t.date.slice(8, 10), 10) || 1;
      byDayOfMonth.set(day, (byDayOfMonth.get(day) ?? 0) + amt);
      const dow = new Date(t.date + 'T12:00:00Z').getUTCDay();
      byDayOfWeek.set(dow, (byDayOfWeek.get(dow) ?? 0) + amt);
      const merchant = (t.merchant || '').trim() || 'Unknown';
      byMerchant.set(merchant, (byMerchant.get(merchant) ?? 0) + amt);
      const catId = t.categoryId;
      const cur = byCategory.get(catId);
      if (!cur) byCategory.set(catId, { name: t.category.name, amount: amt });
      else cur.amount += amt;
      if (largest == null || amt > largest.amount) {
        largest = {
          amount: amt,
          date: t.date,
          merchant: t.merchant,
          category_name: t.category.name,
        };
      }
    }

    const currentTotal = transactions.reduce((s, t) => s + effectiveAmount(t), 0);
    const previousTotal = previousTransactions.reduce((s, t) => s + effectiveAmount(t), 0);
    let spending_trend: { trend: 'up' | 'down' | 'same'; percent_change: number; current_total: number; previous_total: number } | null = null;
    if (previousTotal > 0) {
      const percent_change = ((currentTotal - previousTotal) / previousTotal) * 100;
      const trend = percent_change > 0 ? 'up' : percent_change < 0 ? 'down' : 'same';
      spending_trend = {
        trend,
        percent_change: Math.round(percent_change * 10) / 10,
        current_total: Math.round(currentTotal * 100) / 100,
        previous_total: Math.round(previousTotal * 100) / 100,
      };
    } else if (currentTotal > 0) {
      spending_trend = { trend: 'up', percent_change: 100, current_total: Math.round(currentTotal * 100) / 100, previous_total: 0 };
    }

    const peakHour = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
    const peakDay = [...byDayOfMonth.entries()].sort((a, b) => b[1] - a[1])[0];
    const peakDayOfWeek = [...byDayOfWeek.entries()].sort((a, b) => b[1] - a[1])[0];
    const topVendor = [...byMerchant.entries()].sort((a, b) => b[1] - a[1])[0];
    const topCat = [...byCategory.entries()].sort((a, b) => b[1].amount - a[1].amount)[0];

    res.json({
      peak_time_of_day: peakHour ? { hour: peakHour[0], amount: Math.round(peakHour[1] * 100) / 100 } : null,
      peak_day_of_month: peakDay ? { day: peakDay[0], amount: Math.round(peakDay[1] * 100) / 100 } : null,
      peak_day_of_week: peakDayOfWeek ? { day_of_week: peakDayOfWeek[0], day_name: DAY_NAMES[peakDayOfWeek[0]], amount: Math.round(peakDayOfWeek[1] * 100) / 100 } : null,
      top_vendor: topVendor ? { name: topVendor[0], amount: Math.round(topVendor[1] * 100) / 100 } : null,
      top_category: topCat ? { name: topCat[1].name, amount: Math.round(topCat[1].amount * 100) / 100 } : null,
      spending_trend: spending_trend ?? null,
      largest_transaction: largest ? { amount: Math.round(largest.amount * 100) / 100, date: largest.date, merchant: largest.merchant ?? '—', category_name: largest.category_name } : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get spending patterns' });
  }
});

function parseHour(timeStr: string): number {
  const part = timeStr.trim().slice(0, 5);
  const [h] = part.split(':').map((s) => parseInt(s, 10));
  if (Number.isFinite(h) && h >= 0 && h <= 23) return h;
  return 12;
}

/**
 * GET /v1/insights/predict-end-of-month
 * Query: month (YYYY-MM). Returns optimistic (recurring-only projection) and worst-case (daily average) predictions.
 */
insightsRouter.get('/predict-end-of-month', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const month = (req.query.month as string)?.trim() || getCurrentCalendarMonth();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(422).json({ error: 'month (YYYY-MM) is required' });
      return;
    }
    const [start, end] = monthRangeForMonth(month);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const endDate = new Date(end + 'T12:00:00Z');
    const currentDate = todayStr > end ? end : todayStr;

    const transactions = await prisma.transaction.findMany({
      where: { userId, date: { gte: start, lte: currentDate } },
      select: { amount: true, egpValue: true, date: true, merchant: true },
    });
    const spentSoFar = transactions.reduce((s, t) => s + effectiveAmount(t), 0);
    const startDate = new Date(start + 'T12:00:00Z');
    const currentDateObj = new Date(currentDate + 'T12:00:00Z');
    const daysElapsed = Math.max(1, Math.round((currentDateObj.getTime() - startDate.getTime()) / 86400000) + 1);
    const daysInMonth = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    const daysRemaining = Math.max(0, daysInMonth - daysElapsed);

    // Group by vendor (merchant); recurring = vendors with 2+ transactions
    const byMerchant = new Map<string, { count: number; total: number }>();
    for (const t of transactions) {
      const merchant = (t.merchant || '').trim() || 'Unknown';
      const amt = effectiveAmount(t);
      const cur = byMerchant.get(merchant);
      if (!cur) byMerchant.set(merchant, { count: 1, total: amt });
      else { cur.count += 1; cur.total += amt; }
    }
    let recurringTotal = 0;
    let recurringVendorsCount = 0;
    for (const [, v] of byMerchant) {
      if (v.count >= 2) {
        recurringTotal += v.total;
        recurringVendorsCount += 1;
      }
    }
    const oneOffTotal = Math.round((spentSoFar - recurringTotal) * 100) / 100;

    // Optimistic: only recurring spend is projected to continue at same rate
    const recurringDailyRate = daysElapsed > 0 ? recurringTotal / daysElapsed : 0;
    const optimisticProjectedAdditional = recurringDailyRate * daysRemaining;
    const optimisticPredictedTotal = Math.round((spentSoFar + optimisticProjectedAdditional) * 100) / 100;

    // More likely: optimistic + top 2 one-off transactions assumed to repeat once each
    const oneOffTx: { amount: number; merchant: string | null }[] = [];
    for (const t of transactions) {
      const merchant = (t.merchant || '').trim() || 'Unknown';
      if ((byMerchant.get(merchant)?.count ?? 0) >= 2) continue;
      oneOffTx.push({ amount: effectiveAmount(t), merchant: t.merchant });
    }
    oneOffTx.sort((a, b) => b.amount - a.amount);
    const topTwoOneOff = oneOffTx.slice(0, 2);
    const oneOffRepeatSum = topTwoOneOff.reduce((s, t) => s + t.amount, 0);
    const moreLikelyPredictedTotal = Math.round((optimisticPredictedTotal + oneOffRepeatSum) * 100) / 100;

    // Worst case: current daily rate continues for full month
    const dailyRate = spentSoFar / daysElapsed;
    const worstCasePredictedTotal = Math.round(dailyRate * daysInMonth * 100) / 100;

    const moreLikelyParts = topTwoOneOff.map((t) => `EGP ${Math.round(t.amount)} (${t.merchant || 'Unknown'})`);
    const moreLikelyText = topTwoOneOff.length > 0
      ? `Optimistic plus ${topTwoOneOff.length} one-off transaction(s) assumed to repeat once: ${moreLikelyParts.join(', ')}.`
      : 'Same as optimistic; no one-off transactions to project.';

    const payload = {
      spent_so_far: Math.round(spentSoFar * 100) / 100,
      days_elapsed: daysElapsed,
      days_remaining: daysRemaining,
      recurring_total: Math.round(recurringTotal * 100) / 100,
      one_off_total: oneOffTotal,
      recurring_vendors_count: recurringVendorsCount,
      optimistic_predicted_total: optimisticPredictedTotal,
      more_likely_predicted_total: moreLikelyPredictedTotal,
      worst_case_predicted_total: worstCasePredictedTotal,
      optimistic_text: recurringVendorsCount > 0
        ? `Only recurring spending (${recurringVendorsCount} vendor(s), EGP ${Math.round(recurringTotal)} so far) is projected to continue. One-off spend not repeated.`
        : 'No recurring vendors (same merchant 2+ times) this month; projection equals spending so far.',
      more_likely_text: moreLikelyText,
      worst_case_text: `If current daily rate (EGP ${Math.round(dailyRate)}/day) continues through month end.`,
    };
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get prediction' });
  }
});

/** Diagnostic: list each category with its transaction count and total amount. Use to spot duplicate names or mismatched ids (e.g. Subscriptions showing 0). */
insightsRouter.get('/category-counts', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [categories, transactions] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        orderBy: [{ name: 'asc' }],
        select: { id: true, name: true, parentId: true },
      }),
      prisma.transaction.findMany({
        where: { userId },
        select: { categoryId: true, amount: true, egpValue: true },
      }),
    ]);
    const byCat = new Map<string, { count: number; total: number }>();
    for (const t of transactions) {
      const cur = byCat.get(t.categoryId) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += effectiveAmount(t);
      byCat.set(t.categoryId, cur);
    }
    const items = categories.map((c) => {
      const cur = byCat.get(c.id);
      return {
        id: c.id,
        name: c.name,
        parent_id: c.parentId,
        transaction_count: cur?.count ?? 0,
        total_amount: Math.round((cur?.total ?? 0) * 100) / 100,
      };
    });
    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get category counts' });
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
