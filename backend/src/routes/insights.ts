import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { effectiveAmount } from '../lib/transaction';

export const insightsRouter = Router();
insightsRouter.use(authMiddleware);

/** In-memory cache for spending-explanation and anomalies. Key -> { value, cachedAt } */
const insightsCache = new Map<string, { value: unknown; cachedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const BIG_TX_TOP_N = 15; // Use average of top N transactions to define "big"
const BIG_TX_FALLBACK_EGP = 1000; // Fallback when user has no/single transaction

/**
 * Computes the "big transaction" threshold for a user: average of their top 15 transactions by effective amount (EGP).
 * Used to invalidate cache when a new transaction of that size or larger is added.
 */
async function getBigTransactionThreshold(userId: string): Promise<number> {
  const tx = await prisma.transaction.findMany({
    where: { userId },
    select: { amount: true, egpValue: true },
    orderBy: { date: 'desc' },
    take: 500,
  });
  const amounts = tx.map((t) => effectiveAmount(t)).filter((a) => a > 0);
  if (amounts.length === 0) return BIG_TX_FALLBACK_EGP;
  amounts.sort((a, b) => b - a);
  const top = amounts.slice(0, BIG_TX_TOP_N);
  const avg = top.reduce((s, a) => s + a, 0) / top.length;
  return Math.round(avg);
}

/**
 * Returns true if there is any transaction in [from, to] with effective amount >= threshold
 * that was created after sinceDate (used to invalidate cache).
 */
async function hasNewBigTransactionsSince(
  userId: string,
  from: string,
  to: string,
  sinceDate: Date,
  threshold: number
): Promise<boolean> {
  const tx = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: from, lte: to },
      createdAt: { gt: sinceDate },
    },
    select: { amount: true, egpValue: true },
  });
  return tx.some((t) => effectiveAmount(t) >= threshold);
}

async function isCacheValid(key: string, userId: string, from: string, to: string): Promise<boolean> {
  const entry = insightsCache.get(key);
  if (!entry) return false;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return false;
  const threshold = await getBigTransactionThreshold(userId);
  const hasNew = await hasNewBigTransactionsSince(userId, from, to, new Date(entry.cachedAt), threshold);
  return !hasNew;
}

function setCache(key: string, value: unknown): void {
  insightsCache.set(key, { value, cachedAt: Date.now() });
}

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

function buildTransactionWhere(userId: string, from: string, to: string, q?: string) {
  const base = { userId, date: { gte: from, lte: to } as { gte: string; lte: string } };
  const qLower = (q || '').trim().toLowerCase();
  if (qLower.length === 0) return base;
  return {
    ...base,
    OR: [
      { merchant: { contains: qLower, mode: 'insensitive' as const } },
      { category: { name: { contains: qLower, mode: 'insensitive' as const } } },
      { tags: { some: { tag: { name: { contains: qLower, mode: 'insensitive' as const } } } } },
    ],
  };
}

/**
 * GET /v1/insights/spending-patterns
 * Query: from, to (YYYY-MM-DD), q (optional search). Returns when you spend more (time of day, day of month), top vendor, top category.
 */
insightsRouter.get('/spending-patterns', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    const q = (req.query.q as string)?.trim() || '';
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(422).json({ error: 'from and to (YYYY-MM-DD) are required' });
      return;
    }

    const txWhere = buildTransactionWhere(userId, from, to, q);

    const [transactions, previousTransactions] = await Promise.all([
      prisma.transaction.findMany({
        where: txWhere,
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
 * Query: month (YYYY-MM), q (optional search: merchant/category/tag). Returns predictions.
 */
insightsRouter.get('/predict-end-of-month', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const month = (req.query.month as string)?.trim() || getCurrentCalendarMonth();
    const qRaw = (req.query.q as string)?.trim() || '';
    const q = qRaw.toLowerCase();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(422).json({ error: 'month (YYYY-MM) is required' });
      return;
    }
    const [start, end] = monthRangeForMonth(month);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const endDate = new Date(end + 'T12:00:00Z');
    const currentDate = todayStr > end ? end : todayStr;

    const where: { userId: string; date: { gte: string; lte: string }; OR?: Array<Record<string, unknown>> } = {
      userId,
      date: { gte: start, lte: currentDate },
    };
    if (q.length > 0) {
      where.OR = [
        { merchant: { contains: q, mode: 'insensitive' as const } },
        { category: { name: { contains: q, mode: 'insensitive' as const } } },
        { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' as const } } } } },
      ];
    }

    const transactions = await prisma.transaction.findMany({
      where,
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

type OpenAiChatResult = { content: string | null; error?: string };

/**
 * Call OpenAI chat/completions with a specific model. Returns content and optional error message.
 */
async function openAiChatWithModel(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  model: string,
  baseURL: string,
  apiKey: string
): Promise<OpenAiChatResult> {
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_completion_tokens: maxTokens,
        temperature: 0.4,
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      let errMsg = `API error ${res.status}`;
      try {
        const errJson = JSON.parse(body) as { error?: { message?: string; code?: string } };
        if (errJson?.error?.message) errMsg = errJson.error.message;
        else if (errJson?.error?.code) errMsg = `${errJson.error.code}: ${errJson.error.message || body.slice(0, 200)}`;
      } catch {
        if (body.length) errMsg = `${errMsg}: ${body.slice(0, 200)}`;
      }
      console.error('[insights] OpenAI chat:', errMsg);
      return { content: null, error: errMsg };
    }
    const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? null;
    if (!content && (data.choices?.length ?? 0) > 0) {
      console.error('[insights] OpenAI chat: 200 OK but empty content. Body:', body.slice(0, 300));
      return { content: null, error: 'Empty response from model (try OPENAI_MODEL=gpt-4o-mini)' };
    }
    return { content, error: undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[insights] OpenAI chat exception:', e);
    return { content: null, error: msg };
  }
}

/**
 * Call OpenAI chat/completions. Uses OPENAI_MODEL; if that model returns empty content, retries with gpt-4o-mini.
 */
async function openAiChat(systemPrompt: string, userPrompt: string, maxTokens = 300): Promise<OpenAiChatResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { content: null, error: 'OPENAI_API_KEY not set' };
  let baseURL = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  if (!baseURL.endsWith('/v1')) baseURL = `${baseURL}/v1`;
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const result = await openAiChatWithModel(systemPrompt, userPrompt, maxTokens, model, baseURL, apiKey);
  if (result.content) return result;
  if (result.error === 'Empty response from model (try OPENAI_MODEL=gpt-4o-mini)' && model !== 'gpt-4o-mini') {
    console.warn('[insights] Retrying with gpt-4o-mini after empty content from', model);
    return openAiChatWithModel(systemPrompt, userPrompt, maxTokens, 'gpt-4o-mini', baseURL, apiKey);
  }
  return result;
}

/**
 * GET /v1/insights/spending-explanation
 * Query: from, to (YYYY-MM-DD), q (optional search). Returns a short natural-language summary of spending.
 * Cached per userId/from/to/q; cache invalidated when a new transaction >= 1000 EGP is added in the range.
 */
insightsRouter.get('/spending-explanation', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    const q = (req.query.q as string)?.trim() || '';
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(422).json({ error: 'from and to (YYYY-MM-DD) are required' });
      return;
    }

    const cacheKey = `spending-explanation:${userId}:${from}:${to}:${q}`;
    if (q === '' && (await isCacheValid(cacheKey, userId, from, to))) {
      const entry = insightsCache.get(cacheKey);
      if (entry) {
        res.json(entry.value);
        return;
      }
    } else if (q !== '') {
      const entry = insightsCache.get(cacheKey);
      if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
        res.json(entry.value);
        return;
      }
    }

    const txWhere = buildTransactionWhere(userId, from, to, q);
    const transactions = await prisma.transaction.findMany({
      where: txWhere,
      include: { category: { select: { id: true, name: true } } },
    });

    const total = transactions.reduce((s, t) => s + effectiveAmount(t), 0);
    const byCategory = new Map<string, { name: string; total: number; count: number; merchants: Map<string, { amount: number; count: number }> }>();
    for (const t of transactions) {
      const amt = effectiveAmount(t);
      const catId = t.categoryId;
      const catName = t.category.name;
      let cur = byCategory.get(catId);
      if (!cur) {
        cur = { name: catName, total: 0, count: 0, merchants: new Map() };
        byCategory.set(catId, cur);
      }
      cur.total += amt;
      cur.count += 1;
      const merchant = (t.merchant || '').trim() || 'Unknown';
      const m = cur.merchants.get(merchant);
      if (!m) cur.merchants.set(merchant, { amount: amt, count: 1 });
      else { m.amount += amt; m.count += 1; }
    }

    const categoryLines: string[] = [];
    for (const [, data] of byCategory) {
      const topMerchants = [...data.merchants.entries()]
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 5)
        .map(([name, v]) => `${name}: EGP ${Math.round(v.amount)} (${v.count} tx)`);
      categoryLines.push(`- ${data.name}: ${Math.round(data.total)} EGP, ${data.count} transactions. Top: ${topMerchants.join('; ')}`);
    }
    const categorySummary = categoryLines.join('\n');
    const periodLabel = from === to ? from : `${from} to ${to}`;

    const userPrompt = `Spending from ${periodLabel}. Total: EGP ${Math.round(total)}. By category:\n${categorySummary}\n\nWrite 2-4 short sentences in second person ("You spent...") explaining where the money went. Mention specific merchants or counts when relevant (e.g. "3 Talabat orders"). Be neutral and concise. No bullet points.`;

    const { content: explanation, error: explanationError } = await openAiChat(
      'You are a personal finance assistant. Summarize spending in plain, friendly language.',
      userPrompt,
      250
    );

    const fallback = `Total spend EGP ${Math.round(total)} over this period.`;
    const categoryNames = [...new Set([...byCategory.values()].map((d) => d.name).filter(Boolean))];
    const merchantNames = [...new Set(transactions.map((t) => (t.merchant || '').trim()).filter((m) => m && m !== 'Unknown'))];
    const payload = {
      from,
      to,
      explanation: explanation || fallback + (explanationError ? ` Summary unavailable: ${explanationError}` : ' Natural-language summary could not be generated.'),
      explanation_error: explanationError || undefined,
      category_names: categoryNames,
      merchant_names: merchantNames,
    };
    setCache(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get spending explanation' });
  }
});

/**
 * GET /v1/insights/anomalies
 * Query: from, to (YYYY-MM-DD), q (optional search). Returns anomalies from transactions matching the search.
 * Cached per userId/from/to/q.
 */
insightsRouter.get('/anomalies', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const from = (req.query.from as string)?.trim();
    const to = (req.query.to as string)?.trim();
    const q = (req.query.q as string)?.trim() || '';
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.status(422).json({ error: 'from and to (YYYY-MM-DD) are required' });
      return;
    }

    const cacheKey = `anomalies:${userId}:${from}:${to}:${q}`;
    if (q === '' && (await isCacheValid(cacheKey, userId, from, to))) {
      const entry = insightsCache.get(cacheKey);
      if (entry) {
        res.json(entry.value);
        return;
      }
    } else if (q !== '') {
      const entry = insightsCache.get(cacheKey);
      if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
        res.json(entry.value);
        return;
      }
    }

    const fromDate = new Date(from + 'T12:00:00Z');
    const toDate = new Date(to + 'T12:00:00Z');
    const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);

    const txWhere = buildTransactionWhere(userId, from, to, q);

    const [currentTx, baselineTx] = await Promise.all([
      prisma.transaction.findMany({
        where: txWhere,
        include: { category: { select: { id: true, name: true } } },
      }),
      (async () => {
        const baseEnd = new Date(fromDate);
        baseEnd.setUTCDate(baseEnd.getUTCDate() - 1);
        const baseStart = new Date(baseEnd);
        baseStart.setUTCDate(baseStart.getUTCDate() - days);
        const baseFrom = baseStart.toISOString().slice(0, 10);
        const baseTo = baseEnd.toISOString().slice(0, 10);
        const baseWhere = buildTransactionWhere(userId, baseFrom, baseTo, q);
        return prisma.transaction.findMany({
          where: baseWhere,
          include: { category: { select: { id: true, name: true } } },
        });
      })(),
    ]);

    const anomalies: { type: string; message: string; category_name?: string; amount?: number; merchant?: string; date?: string; transaction_id?: string }[] = [];

    const currentByCat = new Map<string, number>();
    const baselineByCat = new Map<string, number>();
    let currentTotal = 0;
    let baselineTotal = 0;
    const allAmounts: number[] = [];

    for (const t of currentTx) {
      const amt = effectiveAmount(t);
      currentTotal += amt;
      allAmounts.push(amt);
      currentByCat.set(t.categoryId, (currentByCat.get(t.categoryId) ?? 0) + amt);
    }
    for (const t of baselineTx) {
      const amt = effectiveAmount(t);
      baselineTotal += amt;
      baselineByCat.set(t.categoryId, (baselineByCat.get(t.categoryId) ?? 0) + amt);
    }

    const avgTxSize = allAmounts.length > 0 ? allAmounts.reduce((a, b) => a + b, 0) / allAmounts.length : 0;
    const baselineAvgByCat = new Map<string, number>();
    for (const [catId, sum] of baselineByCat) {
      const count = baselineTx.filter((t) => t.categoryId === catId).length;
      baselineAvgByCat.set(catId, count > 0 ? sum / count : 0);
    }

    for (const t of currentTx) {
      const amt = effectiveAmount(t);
      if (avgTxSize > 0 && amt >= avgTxSize * 3) {
        const catName = t.category.name;
        anomalies.push({
          type: 'large_transaction',
          message: `Larger than usual transaction: EGP ${Math.round(amt)} at ${(t.merchant || '').trim() || 'Unknown'} (${catName})`,
          category_name: catName,
          amount: Math.round(amt * 100) / 100,
          merchant: t.merchant ?? undefined,
          date: t.date,
          transaction_id: t.id,
        });
      }
    }

    for (const [catId, currentSum] of currentByCat) {
      const baselineSum = baselineByCat.get(catId) ?? 0;
      if (baselineSum > 0 && currentSum >= baselineSum * 2) {
        const catName = currentTx.find((t) => t.categoryId === catId)?.category.name ?? 'Unknown';
        anomalies.push({
          type: 'category_spend',
          message: `Unusual spend in ${catName} this period: EGP ${Math.round(currentSum)} (about ${(currentSum / baselineSum).toFixed(1)}x usual)`,
          category_name: catName,
          amount: Math.round(currentSum * 100) / 100,
        });
      }
    }

    if (anomalies.length > 0) {
      const list = anomalies.map((a) => a.message).join('\n');
      const { content: rewritten } = await openAiChat(
        'You are a personal finance assistant. Rewrite anomaly alerts in a short, friendly way. One line per anomaly. Keep amounts and key facts.',
        `Rewrite these alerts concisely, one per line:\n${list}`,
        200
      );
      if (rewritten) {
        const lines = rewritten.split('\n').filter((s) => s.trim());
        anomalies.forEach((a, i) => {
          if (lines[i]) a.message = lines[i].replace(/^[-*]\s*/, '').trim();
        });
      }
    }

    const payload = { from, to, anomalies };
    setCache(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get anomalies' });
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
