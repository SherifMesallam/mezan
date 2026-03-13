import { useState, useEffect, Children, isValidElement, cloneElement, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { api } from '../api';
import { getStoredToken } from '../App';

function formatAmount(value: number, decimals: number = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

type Transaction = {
  id: string;
  amount: number;
  currency: string;
  date: string;
  time: string | null;
  merchant: string | null;
  category_id?: string;
  category: { id: string; name: string } | null;
};

type Category = { id: string; name: string };

type BudgetStatus = {
  scope_type: string;
  scope_id: string | null;
  amount: number;
  spent: number;
  remaining: number;
  overspent: boolean;
};

type SummaryItem = { key: string; total: number };

type BudgetByCategoryItem = {
  category_id: string;
  category_name: string;
  budget: number;
  actual: number;
  difference: number;
};

type SpendingPatterns = {
  peak_time_of_day: { hour: number; amount: number } | null;
  peak_day_of_month: { day: number; amount: number } | null;
  peak_day_of_week: { day_of_week: number; day_name: string; amount: number } | null;
  top_vendor: { name: string; amount: number } | null;
  top_category: { name: string; amount: number } | null;
  spending_trend: { trend: 'up' | 'down' | 'same'; percent_change: number; current_total: number; previous_total: number } | null;
  largest_transaction: { amount: number; date: string; merchant: string; category_name: string } | null;
};

type Prediction = {
  spent_so_far: number;
  days_elapsed: number;
  days_remaining: number;
  optimistic_predicted_total: number;
  more_likely_predicted_total: number;
  worst_case_predicted_total: number;
  optimistic_text: string;
  more_likely_text: string;
  worst_case_text: string;
};

type SpendingExplanation = {
  from: string;
  to: string;
  explanation: string;
  category_names?: string[];
  merchant_names?: string[];
};

type Anomaly = {
  type: string;
  message: string;
  category_name?: string;
  amount?: number;
  merchant?: string;
  date?: string;
  transaction_id?: string;
};

const PIE_COLORS = [
  '#0d9b9e', '#0b8588', '#2196F3', '#E91E63', '#795548', '#9E9E9E', '#FF9800', '#4CAF50',
  '#607D8B', '#00BCD4', '#FF5722', '#3F51B5', '#009688', '#8BC34A', '#03A9F4', '#CDDC39',
];

const HOME_SECTION_ORDER_KEY = 'mezan_home_section_order';
const DEFAULT_SECTION_ORDER = [
  'spending-summary',
  'anomalies',
  'insights',
  'prediction',
  'spending-by-category',
  'budget-vs-actual',
  'summary-by-category',
  'recent-transactions',
];

function loadSectionOrder(): string[] {
  try {
    const raw = localStorage.getItem(HOME_SECTION_ORDER_KEY);
    if (!raw) return [...DEFAULT_SECTION_ORDER];
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return [...DEFAULT_SECTION_ORDER];
    const known = new Set(DEFAULT_SECTION_ORDER);
    const ordered = parsed.filter((id) => known.has(id));
    const missing = DEFAULT_SECTION_ORDER.filter((id) => !ordered.includes(id));
    return [...ordered, ...missing];
  } catch {
    return [...DEFAULT_SECTION_ORDER];
  }
}

function DraggableSection({
  id,
  onReorder,
  children,
}: {
  id: string;
  onReorder: (fromId: string, toId: string) => void;
  children: React.ReactNode;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const fromId = e.dataTransfer.getData('text/plain');
    if (fromId && fromId !== id) onReorder(fromId, id);
  }

  const dragProps = { onDragStart: handleDragStart };
  const childrenArray = Children.toArray(children);
  const child = childrenArray.find((c): c is ReactElement => isValidElement(c)) as (ReactElement & { props: { dragProps?: typeof dragProps } }) | undefined;
  const childWithDrag = child ? cloneElement(child, { dragProps }) : children;

  return (
    <div
      className={`home-draggable-section ${isDragOver ? 'home-draggable-section--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {childWithDrag}
    </div>
  );
}

function AnomaliesSection({
  anomalies,
  expanded,
  onToggle,
  dragProps,
}: {
  anomalies: { message: string }[];
  expanded: boolean;
  onToggle: () => void;
  dragProps?: { onDragStart: (e: React.DragEvent) => void };
}) {
  return (
    <div className="card home-anomalies-collapsible" style={{ marginTop: 0, padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        className="home-anomalies-header home-section-title-draggable"
        onClick={onToggle}
        aria-expanded={expanded}
        draggable={!!dragProps}
        onDragStart={dragProps?.onDragStart}
        title={dragProps ? 'Drag to reorder section' : undefined}
      >
        <div style={{ textAlign: 'left', flex: 1 }}>
          <h2 className="home-card-title" style={{ margin: 0 }}>Anomaly alerts</h2>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--mezan-text-muted)', fontWeight: 400 }}>
            {anomalies.length} {anomalies.length === 1 ? 'alert' : 'alerts'}
          </p>
        </div>
        <span
          className="home-anomalies-chevron"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden
        >
          ▼
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid var(--mezan-border, #eee)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
            {anomalies.map((a, i) => (
              <div
                key={i}
                className="card"
                style={{
                  padding: '0.75rem 1rem',
                  margin: 0,
                  background: 'rgba(211, 47, 47, 0.08)',
                  borderLeft: '3px solid var(--mezan-error, #d32f2f)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                }}
              >
                <span style={{ color: 'var(--mezan-error, #d32f2f)', fontSize: '1.1rem' }}>⚠</span>
                <span style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  subtitle,
  expanded,
  onToggle,
  children,
  dragProps,
}: {
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  dragProps?: { onDragStart: (e: React.DragEvent) => void };
}) {
  return (
    <div className="card home-collapsible-section" style={{ marginTop: 0, padding: 0, overflow: 'hidden' }}>
      <button
        type="button"
        className="home-anomalies-header home-section-title-draggable"
        onClick={onToggle}
        aria-expanded={expanded}
        draggable={!!dragProps}
        onDragStart={dragProps?.onDragStart}
        title={dragProps ? 'Drag to reorder section' : undefined}
      >
        <div style={{ textAlign: 'left', flex: 1 }}>
          <h2 className="home-card-title" style={{ margin: 0 }}>{title}</h2>
          {subtitle && (
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--mezan-text-muted)', fontWeight: 400 }}>
              {subtitle}
            </p>
          )}
        </div>
        <span
          className="home-anomalies-chevron"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          aria-hidden
        >
          ▼
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid var(--mezan-border, #eee)' }}>
          <div style={{ marginTop: '0.75rem' }}>{children}</div>
        </div>
      )}
    </div>
  );
}

function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [start, end];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

function groupByDay<T extends { date: string }>(items: T[]): { date: string; items: T[] }[] {
  const byDay = new Map<string, T[]>();
  for (const t of items) {
    const d = t.date.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(t);
  }
  return Array.from(byDay.entries())
    .map(([date, items]) => ({ date, items }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatDayLabel(dateStr: string): string {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (dateStr.slice(0, 10) === todayStr) return 'Today';
  if (dateStr.slice(0, 10) === yesterdayStr) return 'Yesterday';
  return formatShortDate(dateStr);
}

function timeRangeSummary(useAllTime: boolean, useDateRange: boolean, month: string, dateFrom: string, dateTo: string): string {
  if (useAllTime) return 'Showing data for all time';
  if (useDateRange) return `Showing data for ${formatShortDate(dateFrom)} – ${formatShortDate(dateTo)}`;
  return `Showing data for ${formatMonthLabel(month)}`;
}

function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

/** Split answer text and wrap EGP amounts / numbers in emphasized span */
function InsightAnswer({ text }: { text: string }) {
  const re = /(EGP\s*[\d,]+(?:\.\d+)?|[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(text.slice(lastIndex, m.index));
    }
    parts.push(
      <span key={m.index} style={{ color: 'var(--mezan-accent)', fontWeight: 700 }}>
        {m[0]}
      </span>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  if (parts.length === 0) return <>{text}</>;
  return <>{parts}</>;
}

type SpanStyle = 'amount' | 'category' | 'merchant';

/** Spending summary: amounts (accent+bold), category names (bold), merchant names (underline) */
function SpendingSummaryText({
  text,
  categoryNames = [],
  merchantNames = [],
}: {
  text: string;
  categoryNames?: string[];
  merchantNames?: string[];
}) {
  const amountRe = /(EGP\s*[\d,]+(?:\.\d+)?|[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?)/g;
  const ranges: { start: number; end: number; style: SpanStyle }[] = [];
  let m: RegExpExecArray | null;
  while ((m = amountRe.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length, style: 'amount' });
  }
  const catSorted = [...categoryNames].sort((a, b) => b.length - a.length);
  for (const name of catSorted) {
    if (!name) continue;
    let idx = 0;
    const lower = text.toLowerCase();
    const nameLower = name.toLowerCase();
    while ((idx = lower.indexOf(nameLower, idx)) !== -1) {
      ranges.push({ start: idx, end: idx + name.length, style: 'category' });
      idx += 1;
    }
  }
  const merSorted = [...merchantNames].sort((a, b) => b.length - a.length);
  for (const name of merSorted) {
    if (!name) continue;
    let idx = 0;
    const lower = text.toLowerCase();
    const nameLower = name.toLowerCase();
    while ((idx = lower.indexOf(nameLower, idx)) !== -1) {
      ranges.push({ start: idx, end: idx + name.length, style: 'merchant' });
      idx += 1;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let lastEnd = 0;
  const parts: React.ReactNode[] = [];
  for (const r of ranges) {
    if (r.start < lastEnd) continue;
    if (r.start > lastEnd) {
      parts.push(text.slice(lastEnd, r.start));
    }
    const segment = text.slice(r.start, r.end);
    if (r.style === 'amount') {
      parts.push(<span key={`${r.start}-a`} style={{ color: 'var(--mezan-accent)', fontWeight: 700 }}>{segment}</span>);
    } else if (r.style === 'category') {
      parts.push(<span key={`${r.start}-c`} style={{ fontWeight: 700 }}>{segment}</span>);
    } else {
      parts.push(<span key={`${r.start}-m`} style={{ fontStyle: 'italic' }}>{segment}</span>);
    }
    lastEnd = r.end;
  }
  if (lastEnd < text.length) parts.push(text.slice(lastEnd));
  if (parts.length === 0) return <>{text}</>;
  return <>{parts}</>;
}

/** Custom pie label placed further from the pie so label lines are longer */
function PieLabelWithLongLine(props: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  name?: string;
  percent?: number;
}) {
  const { cx = 0, cy = 0, midAngle = 0, outerRadius = 100, name = '', percent = 0 } = props;
  const rad = (-midAngle * Math.PI) / 180;
  const labelRadius = outerRadius + 78;
  const x = cx + labelRadius * Math.cos(rad);
  const y = cy + labelRadius * Math.sin(rad);
  const pctText = (percent * 100).toFixed(0);
  const labelText = percent >= 0.02 ? `${name} ${pctText}%` : `${pctText}%`;
  return (
    <text
      x={x}
      y={y}
      fill="var(--mezan-text)"
      textAnchor={x >= cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={percent >= 0.02 ? 12 : 11}
    >
      {labelText}
    </text>
  );
}

function EditTransactionModal({
  transaction,
  categories,
  token,
  saving,
  onClose,
  onSaved,
  onError,
  setSaving,
}: {
  transaction: Transaction;
  categories: Category[];
  token: string;
  saving: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
  setSaving: (v: boolean) => void;
}) {
  const [amount, setAmount] = useState(String(transaction.amount));
  const [merchant, setMerchant] = useState(transaction.merchant || '');
  const [categoryId, setCategoryId] = useState(transaction.category_id || transaction.category?.id || '');
  const [date, setDate] = useState(transaction.date.slice(0, 10));
  const [time, setTime] = useState(transaction.time || '00:00');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.trim());
    if (Number.isNaN(amt) || amt <= 0) {
      onError('Enter a valid amount');
      return;
    }
    if (!categoryId) {
      onError('Select a category');
      return;
    }
    setSaving(true);
    onError('');
    try {
      await api(`/v1/transactions/${transaction.id}`, {
        method: 'PATCH',
        token,
        body: {
          amount: amt,
          currency: transaction.currency || 'EGP',
          category_id: categoryId,
          date: date.slice(0, 10),
          time: time || null,
          merchant: merchant.trim() || null,
        },
      });
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 400, width: '90%', maxHeight: '90vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 1rem 0' }}>Edit transaction</h3>
        <form onSubmit={handleSubmit}>
          <label className="label">Amount (EGP)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ marginBottom: '0.75rem' }}
          />
          <label className="label">Merchant</label>
          <input
            type="text"
            className="input"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            style={{ marginBottom: '0.75rem' }}
          />
          <label className="label">Category</label>
          <select
            className="input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            style={{ marginBottom: '0.75rem' }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ marginBottom: '0.75rem' }}
          />
          <label className="label">Time</label>
          <input
            type="time"
            className="input"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{ marginBottom: '1rem' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Home() {
  const token = getStoredToken();
  const location = useLocation();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const focusMonth = (location.state as { focusMonth?: string } | null)?.focusMonth;
  const [month, setMonth] = useState(focusMonth || currentMonth);
  const [useDateRange, setUseDateRange] = useState(false);
  const [useAllTime, setUseAllTime] = useState(false);
  const [dateFrom, setDateFrom] = useState(monthRange(currentMonth)[0]);
  const [dateTo, setDateTo] = useState(monthRange(currentMonth)[1]);
  const [timeRangeExpanded, setTimeRangeExpanded] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [, setBudgetStatus] = useState<BudgetStatus[]>([]);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [budgetByCategory, setBudgetByCategory] = useState<{
    items: BudgetByCategoryItem[];
    total_budget: number;
    total_actual: number;
    total_difference: number;
  } | null>(null);
  const [insights, setInsights] = useState<SpendingPatterns | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [spendingExplanation, setSpendingExplanation] = useState<SpendingExplanation | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [anomaliesExpanded, setAnomaliesExpanded] = useState(false);
  const [spendingSummaryExpanded, setSpendingSummaryExpanded] = useState(true);
  const [insightsExpanded, setInsightsExpanded] = useState(true);
  const [predictionExpanded, setPredictionExpanded] = useState(true);
  const [pieChartExpanded, setPieChartExpanded] = useState(true);
  const [barChartExpanded, setBarChartExpanded] = useState(true);
  const [summaryByCategoryExpanded, setSummaryByCategoryExpanded] = useState(true);
  const [recentTransactionsExpanded, setRecentTransactionsExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  type SummarySortKey = 'category_name' | 'budget' | 'actual' | 'difference';
  const [summarySortKey, setSummarySortKey] = useState<SummarySortKey | null>(null);
  const [summarySortDir, setSummarySortDir] = useState<'asc' | 'desc'>('asc');
  const [sectionOrder, setSectionOrder] = useState<string[]>(loadSectionOrder);

  useEffect(() => {
    try {
      localStorage.setItem(HOME_SECTION_ORDER_KEY, JSON.stringify(sectionOrder));
    } catch {
      /* ignore */
    }
  }, [sectionOrder]);

  const [from, to] = useAllTime ? ['2000-01-01', '2030-12-31'] : useDateRange ? [dateFrom, dateTo] : monthRange(month);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    const insightsPromise = api<SpendingPatterns>('/v1/insights/spending-patterns', {
      token,
      query: { from, to },
    }).catch(() => null);
    const predictionPromise = api<Prediction>('/v1/insights/predict-end-of-month', {
      token,
      query: { month },
    }).catch(() => null);
    const explanationPromise = api<SpendingExplanation>('/v1/insights/spending-explanation', {
      token,
      query: { from, to },
    }).catch(() => null);
    const anomaliesPromise = api<{ anomalies: Anomaly[] }>('/v1/insights/anomalies', {
      token,
      query: { from, to },
    }).catch(() => ({ anomalies: [] }));

    Promise.all([
      api<{ transactions: Transaction[]; total_count?: number }>('/v1/transactions', {
        token,
        query: { from, to, limit: '2000' },
      }),
      api<{ categories: { id: string; name: string }[] }>('/v1/categories', { token }),
      api<{ budget_status: BudgetStatus[] }>('/v1/insights/budget-status', {
        token,
        query: { month },
      }),
      api<{ summary: SummaryItem[] }>('/v1/insights/summary', {
        token,
        query: { from, to, group_by: 'category' },
      }),
      api<{
        items: BudgetByCategoryItem[];
        total_budget: number;
        total_actual: number;
        total_difference: number;
      }>('/v1/insights/budget-by-category', {
        token,
        query: useAllTime ? { month, from, to } : { month },
      }),
      insightsPromise,
      predictionPromise,
      explanationPromise,
      anomaliesPromise,
    ])
      .then(([txRes, catRes, budgetRes, summaryRes, byCatRes, insightsRes, predictionRes, explanationRes, anomaliesRes]) => {
        setTransactions(txRes.transactions || []);
        setCategories(catRes.categories || []);
        setBudgetStatus(budgetRes.budget_status || []);
        setSummary(summaryRes.summary || []);
        setBudgetByCategory(byCatRes);
        setInsights(insightsRes ?? null);
        setPrediction(predictionRes ?? null);
        setSpendingExplanation(explanationRes ?? null);
        setAnomalies(anomaliesRes?.anomalies ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, month, from, to, refreshCounter]);

  const nameById = Object.fromEntries((budgetByCategory?.items || []).map((r) => [r.category_id, r.category_name]));
  const pieData = summary.map((s, i) => ({
    name: nameById[s.key] || s.key,
    value: s.total,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));
  const barData = (budgetByCategory?.items || []).map((row) => ({
    name: row.category_name.length > 12 ? row.category_name.slice(0, 11) + '…' : row.category_name,
    fullName: row.category_name,
    budget: row.budget,
    actual: row.actual,
  }));

  const totalSpent = budgetByCategory?.total_actual ?? 0;
  const totalBudget = budgetByCategory?.total_budget ?? 0;
  const totalRemaining = totalBudget - totalSpent;
  const exceedsBudget = totalBudget > 0 && totalSpent > totalBudget;

  const sortedSummaryItems = (() => {
    const items = budgetByCategory?.items ?? [];
    if (!summarySortKey) return items;
    const mult = summarySortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      let va: string | number = a[summarySortKey];
      let vb: string | number = b[summarySortKey];
      if (typeof va === 'string' && typeof vb === 'string') return mult * va.localeCompare(vb);
      return mult * ((va as number) - (vb as number));
    });
  })();

  function handleSummarySort(key: SummarySortKey) {
    if (summarySortKey === key) {
      setSummarySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSummarySortKey(key);
      setSummarySortDir('asc');
    }
  }

  function scrollToPrediction(id: 'prediction-optimistic' | 'prediction-more-likely' | 'prediction-worst-case') {
    setPredictionExpanded(true);
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }

  function handleSectionReorder(fromId: string, toId: string) {
    setSectionOrder((prev) => {
      const fromIdx = prev.indexOf(fromId);
      const toIdx = prev.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, removed);
      return next;
    });
  }

  function isSectionVisible(sid: string): boolean {
    if (sid === 'spending-summary') return !!spendingExplanation?.explanation;
    if (sid === 'anomalies') return anomalies.length > 0;
    if (sid === 'insights') return !!(insights && (insights.peak_time_of_day || insights.peak_day_of_month || insights.peak_day_of_week || insights.top_vendor || insights.top_category || insights.spending_trend || insights.largest_transaction));
    if (sid === 'prediction') return !!prediction;
    return true;
  }

  const orderedVisibleSectionIds = sectionOrder.filter(isSectionVisible);

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <>
      <h1 className="page-title">Home</h1>
      <p className="page-subtitle">Your spending this month</p>

      {/* Time range filter – at the very top */}
      <div className={`card home-timerange ${timeRangeExpanded ? 'home-timerange--expanded' : ''}`}>
        {!timeRangeExpanded ? (
          <button
            type="button"
            className="home-timerange-collapsed"
            onClick={() => setTimeRangeExpanded(true)}
            aria-expanded="false"
            aria-label="Set time range"
          >
            <span className="home-timerange-collapsed-title">
              {timeRangeSummary(useAllTime, useDateRange, month, dateFrom, dateTo)}
            </span>
            <span className="home-timerange-collapsed-hint">Click to set time range</span>
            <span className="home-timerange-collapsed-icon" aria-hidden>▼</span>
          </button>
        ) : (
          <>
            <div className="home-timerange-header home-timerange-header--compact">
              <span className="home-timerange-title">Set time range</span>
              <button
                type="button"
                className="home-timerange-close"
                onClick={() => setTimeRangeExpanded(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="home-timerange-segments" role="tablist" aria-label="Period type">
              <button
                type="button"
                role="tab"
                aria-selected={!useAllTime && !useDateRange}
                className={`home-timerange-segment ${!useAllTime && !useDateRange ? 'home-timerange-segment--active' : ''}`}
                onClick={() => {
                  setUseAllTime(false);
                  setUseDateRange(false);
                }}
              >
                This month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!useAllTime && useDateRange}
                className={`home-timerange-segment ${!useAllTime && useDateRange ? 'home-timerange-segment--active' : ''}`}
                onClick={() => {
                  setUseAllTime(false);
                  const [f, t] = monthRange(month);
                  setDateFrom(f);
                  setDateTo(t);
                  setUseDateRange(true);
                }}
              >
                Custom range
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={useAllTime}
                className={`home-timerange-segment ${useAllTime ? 'home-timerange-segment--active' : ''}`}
                onClick={() => {
                  setUseAllTime(true);
                  setUseDateRange(false);
                }}
              >
                All time
              </button>
            </div>
            <div className="home-timerange-panel">
              {!useAllTime && !useDateRange && (
                <div className="home-timerange-panel-inner">
                  <label className="home-timerange-label">Month</label>
                  <input
                    type="month"
                    className="input home-timerange-month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    aria-label="Select month"
                  />
                </div>
              )}
              {!useAllTime && useDateRange && (
                <div className="home-timerange-panel-inner home-timerange-daterange">
                  <div className="home-timerange-datefield">
                    <label className="home-timerange-label">From</label>
                    <input
                      type="date"
                      className="input home-timerange-date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      aria-label="Start date"
                    />
                  </div>
                  <span className="home-timerange-sep" aria-hidden>to</span>
                  <div className="home-timerange-datefield">
                    <label className="home-timerange-label">To</label>
                    <input
                      type="date"
                      className="input home-timerange-date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      aria-label="End date"
                    />
                  </div>
                </div>
              )}
              {useAllTime && (
                <p className="home-timerange-hint">
                  All transactions are shown. Budget progress below uses the current month.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Summary cards */}
      <div className={`home-summary-cards ${prediction ? 'home-summary-cards--three' : ''}`}>
        <div className="home-summary-card">
          <span className="home-summary-card-label">Total spent</span>
          <span
            className="home-summary-card-value"
            style={{ color: exceedsBudget ? 'var(--mezan-danger)' : 'var(--mezan-accent)' }}
          >
            EGP {formatAmount(totalSpent)}
          </span>
        </div>
        <div className="home-summary-card">
          <span className="home-summary-card-label">Budget remaining</span>
          <span
            className="home-summary-card-value"
            style={{ color: totalRemaining >= 0 ? 'var(--mezan-success)' : 'var(--mezan-danger)' }}
          >
            EGP {formatAmount(totalRemaining)}
          </span>
        </div>
        {prediction && (
          <div className="home-summary-card home-summary-card--predictions">
            <span className="home-summary-card-label">Predictions</span>
            <p className="home-predictions-intro">
              Estimated total spend by end of month based on current pace. Click a tile to jump to details.
            </p>
            <div className="home-predictions-inner">
              <button
                type="button"
                className="home-predictions-tile home-predictions-tile--optimistic"
                onClick={() => scrollToPrediction('prediction-optimistic')}
                aria-label="Scroll to Optimistic prediction"
              >
                <span className="home-predictions-tile-label">Optimistic</span>
                <span className="home-predictions-tile-value" style={{ color: 'var(--mezan-accent)' }}>
                  EGP {formatAmount(prediction.optimistic_predicted_total, 0)}
                </span>
              </button>
              <button
                type="button"
                className="home-predictions-tile home-predictions-tile--more-likely"
                onClick={() => scrollToPrediction('prediction-more-likely')}
                aria-label="Scroll to More likely prediction"
              >
                <span className="home-predictions-tile-label">More likely</span>
                <span className="home-predictions-tile-value" style={{ color: 'var(--mezan-budget-col)' }}>
                  EGP {formatAmount(prediction.more_likely_predicted_total, 0)}
                </span>
              </button>
              <button
                type="button"
                className="home-predictions-tile home-predictions-tile--worst-case"
                onClick={() => scrollToPrediction('prediction-worst-case')}
                aria-label="Scroll to Worst case prediction"
              >
                <span className="home-predictions-tile-label">Worst case</span>
                <span className="home-predictions-tile-value" style={{ color: 'var(--mezan-danger)' }}>
                  EGP {formatAmount(prediction.worst_case_predicted_total, 0)}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {orderedVisibleSectionIds.map((id) => (
        <DraggableSection key={id} id={id} onReorder={handleSectionReorder}>
          {id === 'spending-summary' && spendingExplanation?.explanation && (
        <CollapsibleSection
          title="Spending summary"
          expanded={spendingSummaryExpanded}
          onToggle={() => setSpendingSummaryExpanded((v) => !v)}
        >
          {(() => {
            const sentences = spendingExplanation.explanation
              .split(/\.\s+(?=[A-Z])/)
              .map((s: string) => s.trim())
              .filter(Boolean);
            const categoryNames = spendingExplanation.category_names ?? [];
            const merchantNames = spendingExplanation.merchant_names ?? [];
            const content =
              sentences.length > 0
                ? sentences.map((sentence: string, i: number) => {
                    const text = sentence.endsWith('.') || /[!?]$/.test(sentence) ? sentence : `${sentence}.`;
                    return (
                      <div key={i} className="home-spending-summary-card">
                        <SpendingSummaryText text={text} categoryNames={categoryNames} merchantNames={merchantNames} />
                      </div>
                    );
                  })
                : (
                  <div className="home-spending-summary-card">
                    <SpendingSummaryText
                      text={spendingExplanation.explanation}
                      categoryNames={categoryNames}
                      merchantNames={merchantNames}
                    />
                  </div>
                );
            return <div className="home-spending-summary-list">{content}</div>;
          })()}
        </CollapsibleSection>
          )}
          {id === 'insights' && insights && (insights.peak_time_of_day || insights.peak_day_of_month || insights.peak_day_of_week || insights.top_vendor || insights.top_category || insights.spending_trend || insights.largest_transaction) && (
        <CollapsibleSection
          title="Insights"
          expanded={insightsExpanded}
          onToggle={() => setInsightsExpanded((v) => !v)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {insights.peak_time_of_day && (
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#f8f9fa' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>
                  When do you usually spend more (time of day)?
                </p>
                <p style={{ margin: '0.35rem 0 0 0', fontWeight: 600 }}>
                  <InsightAnswer
                    text={`Around ${hourLabel(insights.peak_time_of_day.hour)} (EGP ${formatAmount(insights.peak_time_of_day.amount, 0)} in that hour)`}
                  />
                </p>
              </div>
            )}
            {insights.peak_day_of_month && (
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#f8f9fa' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>
                  When do you usually spend more (day of month)?
                </p>
                <p style={{ margin: '0.35rem 0 0 0', fontWeight: 600 }}>
                  <InsightAnswer
                    text={`Around day ${insights.peak_day_of_month.day} (EGP ${formatAmount(insights.peak_day_of_month.amount, 0)} on that day)`}
                  />
                </p>
              </div>
            )}
            {insights.peak_day_of_week && (
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#f8f9fa' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>
                  Busiest day of week (by spend)?
                </p>
                <p style={{ margin: '0.35rem 0 0 0', fontWeight: 600 }}>
                  <InsightAnswer
                    text={`${insights.peak_day_of_week.day_name} — EGP ${formatAmount(insights.peak_day_of_week.amount, 0)}`}
                  />
                </p>
              </div>
            )}
            {insights.top_vendor && (
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#f8f9fa' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>
                  What vendor is taking most of your money?
                </p>
                <p style={{ margin: '0.35rem 0 0 0', fontWeight: 600 }}>
                  <InsightAnswer text={`${insights.top_vendor.name} — EGP ${formatAmount(insights.top_vendor.amount, 0)}`} />
                </p>
              </div>
            )}
            {insights.top_category && (
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#f8f9fa' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>
                  What category is taking most of your spending?
                </p>
                <p style={{ margin: '0.35rem 0 0 0', fontWeight: 600 }}>
                  <InsightAnswer text={`${insights.top_category.name} — EGP ${formatAmount(insights.top_category.amount, 0)}`} />
                </p>
              </div>
            )}
            {insights.spending_trend && (
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#f8f9fa' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>
                  Spending trend vs previous period?
                </p>
                <p style={{ margin: '0.35rem 0 0 0', fontWeight: 600 }}>
                  <InsightAnswer
                    text={`${insights.spending_trend.trend === 'up' ? 'Up' : insights.spending_trend.trend === 'down' ? 'Down' : 'Same'} ${insights.spending_trend.percent_change >= 0 ? '+' : ''}${insights.spending_trend.percent_change.toFixed(1)}% vs previous period`}
                  />
                </p>
              </div>
            )}
            {insights.largest_transaction && (
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#f8f9fa' }}>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>
                  Largest transaction?
                </p>
                <p style={{ margin: '0.35rem 0 0 0', fontWeight: 600 }}>
                  <InsightAnswer
                    text={`EGP ${formatAmount(insights.largest_transaction.amount, 0)} — ${insights.largest_transaction.merchant} (${insights.largest_transaction.date})`}
                  />
                </p>
              </div>
            )}
          </div>
        </CollapsibleSection>
          )}
          {id === 'prediction' && prediction && (
        <CollapsibleSection
          title="Prediction"
          expanded={predictionExpanded}
          onToggle={() => setPredictionExpanded((v) => !v)}
        >
          <div>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--mezan-text-muted)' }}>
            Given current spending, how much total spend is predicted by end of month?
          </p>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
            Spent so far: <span style={{ fontWeight: 600, color: 'var(--mezan-accent)' }}>EGP {formatAmount(prediction.spent_so_far, 0)}</span>
            {' · '}{prediction.days_remaining} days left in month
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            <div id="prediction-optimistic" className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#e8f5e9' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>Optimistic prediction</p>
              <p style={{ margin: '0.35rem 0 0 0', fontWeight: 700, fontSize: '1.1rem', color: 'var(--mezan-accent)' }}>
                EGP {formatAmount(prediction.optimistic_predicted_total, 0)}
              </p>
              {prediction.optimistic_text && (
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', lineHeight: 1.35 }}>{prediction.optimistic_text}</p>
              )}
            </div>
            <div id="prediction-more-likely" className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#e3f2fd' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>More likely</p>
              <p style={{ margin: '0.35rem 0 0 0', fontWeight: 700, fontSize: '1.1rem', color: 'var(--mezan-success)' }}>
                EGP {formatAmount(prediction.more_likely_predicted_total, 0)}
              </p>
              {prediction.more_likely_text && (
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', lineHeight: 1.35 }}>{prediction.more_likely_text}</p>
              )}
            </div>
            <div id="prediction-worst-case" className="card" style={{ padding: '0.75rem 1rem', margin: 0, background: '#ffebee' }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--mezan-text-muted)' }}>Worst case</p>
              <p style={{ margin: '0.35rem 0 0 0', fontWeight: 700, fontSize: '1.1rem', color: 'var(--mezan-danger)' }}>
                EGP {formatAmount(prediction.worst_case_predicted_total, 0)}
              </p>
              {prediction.worst_case_text && (
                <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', lineHeight: 1.35 }}>{prediction.worst_case_text}</p>
              )}
            </div>
          </div>
          </div>
        </CollapsibleSection>
          )}
          {id === 'spending-by-category' && (
      <CollapsibleSection
        title="Spending by category"
        expanded={pieChartExpanded}
        onToggle={() => setPieChartExpanded((v) => !v)}
      >
      <div className="home-chart-row">
        <div className="card home-chart-card home-chart-card--pie" style={{ margin: 0 }}>
          {pieData.length === 0 ? (
            <p className="home-chart-empty">No spending this month.</p>
          ) : (
            <ResponsiveContainer width="100%" height={520}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={140}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={<PieLabelWithLongLine />}
                  labelLine={{ stroke: 'var(--mezan-text-muted)', strokeWidth: 1 }}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={pieData[i].color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `EGP ${formatAmount(v)}`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      </CollapsibleSection>
          )}
          {id === 'budget-vs-actual' && (
      <CollapsibleSection
        title="Budget vs. Actual"
        expanded={barChartExpanded}
        onToggle={() => setBarChartExpanded((v) => !v)}
      >
      <div className="home-chart-row">
        <div className="card home-chart-card home-chart-card--bar" style={{ margin: 0 }}>
          {barData.length === 0 ? (
            <p className="home-chart-empty">No categories or data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 60 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `EGP ${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number) => [`EGP ${formatAmount(v)}`, '']}
                  labelFormatter={(_, payload) => payload[0]?.payload?.fullName ?? ''}
                />
                <Legend />
                <Bar dataKey="budget" name="Budget" fill="var(--mezan-accent)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill="var(--mezan-success)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      </CollapsibleSection>
          )}
          {id === 'summary-by-category' && (
      <CollapsibleSection
        title="Summary by Category"
        expanded={summaryByCategoryExpanded}
        onToggle={() => setSummaryByCategoryExpanded((v) => !v)}
      >
      <div className="card home-summary-card-wrap" style={{ margin: 0, padding: '1rem' }}>
        {!budgetByCategory || budgetByCategory.items.length === 0 ? (
          <p className="home-chart-empty">
            No categories. <Link to="/categories">Add categories</Link> and <Link to="/budgets">set budgets</Link>.
          </p>
        ) : (
          <div className="home-summary-table-wrap">
            <table className="home-summary-table">
              <thead>
                <tr>
                  <th className="home-summary-th-cat home-summary-th-sort" onClick={() => handleSummarySort('category_name')}>
                    Category
                    <span className="home-summary-sort-icon" aria-hidden>
                      {summarySortKey === 'category_name' ? (summarySortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                    </span>
                  </th>
                  <th className="home-summary-th-num home-summary-th-sort" onClick={() => handleSummarySort('budget')}>
                    Budget
                    <span className="home-summary-sort-icon" aria-hidden>
                      {summarySortKey === 'budget' ? (summarySortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                    </span>
                  </th>
                  <th className="home-summary-th-num home-summary-th-sort" onClick={() => handleSummarySort('actual')}>
                    Actual
                    <span className="home-summary-sort-icon" aria-hidden>
                      {summarySortKey === 'actual' ? (summarySortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                    </span>
                  </th>
                  <th className="home-summary-th-num home-summary-th-sort" onClick={() => handleSummarySort('difference')}>
                    Difference
                    <span className="home-summary-sort-icon" aria-hidden>
                      {summarySortKey === 'difference' ? (summarySortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                    </span>
                  </th>
                  <th className="home-summary-th-progress">Progress</th>
                </tr>
              </thead>
              <tbody>
                {sortedSummaryItems.map((row, index) => {
                  const budgetVal = row.budget || 0;
                  const hasBudget = budgetVal > 0;
                  const pctSpent = hasBudget ? Math.min(100, (row.actual / budgetVal) * 100) : 0;
                  const pctRemaining = hasBudget ? Math.max(0, 100 - pctSpent) : 0;
                  const over = hasBudget && row.actual > budgetVal;
                  const overPct = over ? ((row.actual - row.budget) / budgetVal) * 100 : 0;
                  const overflowDisplayPct = Math.min(25, overPct);
                  const overTotal = 100 + overflowDisplayPct;
                  const spentBarW = over ? (100 / overTotal) * 100 : pctSpent;
                  const overflowBarW = over ? (overflowDisplayPct / overTotal) * 100 : 0;
                  return (
                    <tr key={row.category_id} className={index % 2 === 0 ? 'home-summary-row--alt' : ''}>
                      <td className="home-summary-td-cat">{row.category_name}</td>
                      <td className="home-summary-td-num home-summary-td-budget">EGP {formatAmount(row.budget)}</td>
                      <td className="home-summary-td-num home-summary-td-actual">EGP {formatAmount(row.actual)}</td>
                      <td className={`home-summary-td-num home-summary-diff ${row.difference >= 0 ? 'home-summary-diff--ok' : 'home-summary-diff--over'}`}>
                        EGP {formatAmount(row.difference)}
                      </td>
                      <td className="home-summary-td-progress">
                        {hasBudget ? (
                          <div className="home-summary-progress-cell">
                            <div className="home-summary-progress-wrap" title={over ? `Over budget: EGP ${formatAmount(row.actual - row.budget)}` : `${pctSpent.toFixed(0)}% spent`}>
                              <div className="home-summary-progress-bar home-summary-progress-bar--spent" style={{ width: `${spentBarW}%` }} />
                              {!over && <div className="home-summary-progress-bar home-summary-progress-bar--remaining" style={{ width: `${pctRemaining}%` }} />}
                              {over && <div className="home-summary-progress-bar home-summary-progress-bar--overflow" style={{ width: `${overflowBarW}%` }} />}
                            </div>
                            <span className="home-summary-progress-label">
                              {over ? '0% remaining' : `${Math.round(pctRemaining)}% remaining`}
                            </span>
                          </div>
                        ) : (
                          <span className="home-summary-progress-empty">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="home-summary-total">
                  <td className="home-summary-td-cat">Total</td>
                  <td className="home-summary-td-num home-summary-td-budget">EGP {formatAmount(budgetByCategory.total_budget)}</td>
                  <td className="home-summary-td-num home-summary-td-actual">EGP {formatAmount(budgetByCategory.total_actual)}</td>
                  <td className={`home-summary-td-num home-summary-diff ${budgetByCategory.total_difference >= 0 ? 'home-summary-diff--ok' : 'home-summary-diff--over'}`}>
                    EGP {formatAmount(budgetByCategory.total_difference)}
                  </td>
                  <td className="home-summary-td-progress">
                    {budgetByCategory.total_budget > 0 && (() => {
                      const totalBudgetVal = budgetByCategory.total_budget;
                      const totalActual = budgetByCategory.total_actual;
                      const totalPctSpent = Math.min(100, (totalActual / totalBudgetVal) * 100);
                      const totalPctRemaining = Math.max(0, 100 - totalPctSpent);
                      const totalOver = totalActual > totalBudgetVal;
                      const totalOverPct = totalOver ? ((totalActual - totalBudgetVal) / totalBudgetVal) * 100 : 0;
                      const totalOverflowDisplay = Math.min(25, totalOverPct);
                      const totalOverSum = 100 + totalOverflowDisplay;
                      const totalSpentBarW = totalOver ? (100 / totalOverSum) * 100 : totalPctSpent;
                      const totalOverflowBarW = totalOver ? (totalOverflowDisplay / totalOverSum) * 100 : 0;
                      return (
                        <div className="home-summary-progress-cell">
                          <div className="home-summary-progress-wrap" title={totalOver ? `Over: EGP ${formatAmount(totalActual - totalBudgetVal)}` : `${totalPctSpent.toFixed(0)}% spent`}>
                            <div className="home-summary-progress-bar home-summary-progress-bar--spent" style={{ width: `${totalSpentBarW}%` }} />
                            {!totalOver && <div className="home-summary-progress-bar home-summary-progress-bar--remaining" style={{ width: `${totalPctRemaining}%` }} />}
                            {totalOver && <div className="home-summary-progress-bar home-summary-progress-bar--overflow" style={{ width: `${totalOverflowBarW}%` }} />}
                          </div>
                          <span className="home-summary-progress-label">
                            {totalOver ? '0% remaining' : `${Math.round(totalPctRemaining)}% remaining`}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      </CollapsibleSection>
          )}
          {id === 'anomalies' && anomalies.length > 0 && (
        <AnomaliesSection
          anomalies={anomalies}
          expanded={anomaliesExpanded}
          onToggle={() => setAnomaliesExpanded((v) => !v)}
        />
          )}
          {id === 'recent-transactions' && (
      <CollapsibleSection
        title="Recent transactions"
        subtitle={`${transactions.length} this period`}
        expanded={recentTransactionsExpanded}
        onToggle={() => setRecentTransactionsExpanded((v) => !v)}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Link to="/transactions">View all</Link>
          <Link to="/add">Add</Link>
        </div>
      {transactions.length === 0 ? (
        <div className="card">
          <p className="home-empty-note">No transactions this month. <Link to="/add">Add one</Link> or <Link to="/sms">paste from SMS</Link>.</p>
        </div>
      ) : (
        <div className="home-transaction-day-groups">
          {groupByDay(transactions.slice(0, 5)).map(({ date, items }) => (
            <div key={date} className="home-day-card">
              <header className="home-day-card-header">{formatDayLabel(date)}</header>
              <ul className="list home-transaction-list">
                {items.map((t) => (
                  <li key={t.id} className="list-item home-transaction-item">
                    <span className="list-item-main" style={{ flex: 1, minWidth: 0 }}>
                      <strong>{t.merchant || t.category?.name || '—'}</strong>
                      {t.time ? (
                        <span className="home-transaction-date">{t.time}</span>
                      ) : (
                        <span className="home-transaction-date">{t.date}</span>
                      )}
                    </span>
                    <span className="list-item-amount">{t.currency} {formatAmount(t.amount)}</span>
                    {deleteConfirmId === t.id ? (
                      <span style={{ display: 'flex', gap: '0.25rem', fontSize: '0.85rem' }}>
                        <span style={{ color: '#666', marginRight: '0.25rem' }}>Delete?</span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                          onClick={async () => {
                            if (!token) return;
                            setSaving(true);
                            try {
                              await api(`/v1/transactions/${t.id}`, { method: 'DELETE', token });
                              setDeleteConfirmId(null);
                              setRefreshCounter((c) => c + 1);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Delete failed');
                            } finally {
                              setSaving(false);
                            }
                          }}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                          onClick={() => setEditingTransaction(t)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn home-btn-delete"
                          onClick={() => setDeleteConfirmId(t.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {transactions.length > 5 && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
          <Link to="/transactions">View all {transactions.length} transactions →</Link>
        </p>
      )}
      </CollapsibleSection>
          )}
        </DraggableSection>
      ))}

      {editingTransaction && (
        <EditTransactionModal
          transaction={editingTransaction}
          categories={categories}
          token={token!}
          saving={saving}
          onClose={() => setEditingTransaction(null)}
          onSaved={() => {
            setEditingTransaction(null);
            setRefreshCounter((c) => c + 1);
          }}
          onError={setError}
          setSaving={setSaving}
        />
      )}
    </>
  );
}
