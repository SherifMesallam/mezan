import { useState, useEffect } from 'react';
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

type SummaryItem = { key: string; total: number };

type BudgetByCategoryItem = {
  category_id: string;
  category_name: string;
  budget: number;
  actual: number;
  difference: number;
};

const PIE_COLORS = [
  '#0d9b9e',
  '#0b8588',
  '#2196F3',
  '#E91E63',
  '#795548',
  '#9E9E9E',
  '#FF9800',
  '#4CAF50',
  '#607D8B',
  '#00BCD4',
  '#FF5722',
  '#3F51B5',
  '#009688',
  '#8BC34A',
  '#03A9F4',
  '#CDDC39',
];

function getMonthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const now = new Date();
  const isCurrentMonth = now.getFullYear() === y && now.getMonth() + 1 === m;
  const toDay = isCurrentMonth ? Math.min(now.getDate(), lastDay) : lastDay;
  const to = `${y}-${String(m).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`;
  return { from, to };
}

function defaultMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Charts() {
  const token = getStoredToken();
  const [month, setMonth] = useState(defaultMonthValue);
  const [loading, setLoading] = useState(true);
  const [byCategory, setByCategory] = useState<SummaryItem[]>([]);
  const [byTag, setByTag] = useState<SummaryItem[]>([]);
  const [byDay, setByDay] = useState<SummaryItem[]>([]);
  const [budgetByCategory, setBudgetByCategory] = useState<{
    items: BudgetByCategoryItem[];
    total_budget: number;
    total_actual: number;
  } | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);

  const { from, to } = getMonthRange(month);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const monthParam = month;
    Promise.all([
      api<{ summary: SummaryItem[] }>('/v1/insights/summary', {
        token,
        query: { from, to, group_by: 'category' },
      }),
      api<{ summary: SummaryItem[] }>('/v1/insights/summary', {
        token,
        query: { from, to, group_by: 'tag' },
      }),
      api<{ summary: SummaryItem[] }>('/v1/insights/summary', {
        token,
        query: { from, to, group_by: 'day' },
      }),
      api<{
        items: BudgetByCategoryItem[];
        total_budget: number;
        total_actual: number;
      }>('/v1/insights/budget-by-category', { token, query: { month: monthParam } }),
      api<{ categories: { id: string; name: string }[] }>('/v1/categories', { token }),
      api<{ tags: { id: string; name: string }[] }>('/v1/tags', { token }),
    ])
      .then(([catRes, tagRes, dayRes, budgetRes, catListRes, tagListRes]) => {
        setByCategory(catRes.summary || []);
        setByTag(tagRes.summary || []);
        setByDay(dayRes.summary || []);
        setBudgetByCategory(
          budgetRes.items
            ? {
                items: budgetRes.items,
                total_budget: budgetRes.total_budget,
                total_actual: budgetRes.total_actual,
              }
            : null
        );
        setCategories(catListRes.categories || []);
        setTags(tagListRes.tags || []);
      })
      .catch(() => {
        setByCategory([]);
        setByTag([]);
        setByDay([]);
        setBudgetByCategory(null);
      })
      .finally(() => setLoading(false));
  }, [token, month, from, to]);

  const categoryNameById = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const tagNameById = Object.fromEntries(tags.map((t) => [t.id, t.name]));

  const labelCategory = (key: string) => categoryNameById[key] || key;
  const labelTag = (key: string) => (key === '_untagged' ? 'Untagged' : tagNameById[key] || key);

  const pieDataCategory = byCategory.map((s, i) => ({
    name: labelCategory(s.key),
    value: s.total,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const pieDataTag = byTag.map((s, i) => ({
    name: labelTag(s.key),
    value: s.total,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const dailyData = [...byDay]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((s) => ({
      date: s.key,
      label: s.key.slice(5),
      amount: s.total,
    }));

  const budgetBarData = (budgetByCategory?.items || []).map((row) => ({
    name: row.category_name.length > 10 ? row.category_name.slice(0, 9) + '…' : row.category_name,
    fullName: row.category_name,
    budget: row.budget,
    actual: row.actual,
  }));

  const totalCategory = byCategory.reduce((s, x) => s + x.total, 0);
  const totalTag = byTag.reduce((s, x) => s + x.total, 0);

  if (loading) {
    return (
      <div className="charts-page">
        <header className="charts-header">
          <h1 className="page-title">Charts</h1>
          <p className="page-subtitle">Spending and budget overview for the selected month</p>
        </header>
        <div className="charts-loading">Loading charts…</div>
      </div>
    );
  }

  const hasAnyData =
    byCategory.length > 0 ||
    byTag.length > 0 ||
    byDay.length > 0 ||
    (budgetByCategory?.items?.length ?? 0) > 0;

  return (
    <div className="charts-page">
      <header className="charts-header">
        <h1 className="page-title">Charts</h1>
        <p className="page-subtitle">Spending and budget overview for the selected month</p>
      </header>

      <div className="charts-toolbar">
        <div className="charts-control-group">
          <label className="label" htmlFor="charts-month">
            Month
          </label>
          <input
            id="charts-month"
            type="month"
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      {!hasAnyData ? (
        <div className="charts-empty">
          No data for this period. Add transactions or try another month.
        </div>
      ) : (
        <div className="charts-grid">
          {/* Spending by category */}
          <section className="charts-section">
            <h2 className="charts-section-title">Spending by category</h2>
            {byCategory.length === 0 ? (
              <p className="charts-section-empty">No spending by category this month.</p>
            ) : (
              <>
                <div className="charts-donut-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieDataCategory}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                      >
                        {pieDataCategory.map((_, i) => (
                          <Cell key={i} fill={pieDataCategory[i].color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [`EGP ${v.toFixed(2)}`, '']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="charts-legend">
                  {byCategory.map((s, i) => (
                    <li key={s.key} className="charts-legend-item">
                      <span
                        className="charts-legend-swatch"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        aria-hidden
                      />
                      <span className="charts-legend-label">{labelCategory(s.key)}</span>
                      <span className="charts-legend-value">
                        EGP {s.total.toFixed(0)}
                        {totalCategory > 0 && (
                          <span className="charts-legend-pct">
                            ({((s.total / totalCategory) * 100).toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="charts-total">
                  <strong>Total: EGP {totalCategory.toFixed(2)}</strong>
                </p>
              </>
            )}
          </section>

          {/* Spending by tag */}
          <section className="charts-section">
            <h2 className="charts-section-title">Spending by tag</h2>
            {byTag.length === 0 ? (
              <p className="charts-section-empty">No tagged spending this month.</p>
            ) : (
              <>
                <div className="charts-donut-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieDataTag}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                      >
                        {pieDataTag.map((_, i) => (
                          <Cell key={i} fill={pieDataTag[i].color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [`EGP ${v.toFixed(2)}`, '']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="charts-legend">
                  {byTag.map((s, i) => (
                    <li key={s.key} className="charts-legend-item">
                      <span
                        className="charts-legend-swatch"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        aria-hidden
                      />
                      <span className="charts-legend-label">{labelTag(s.key)}</span>
                      <span className="charts-legend-value">
                        EGP {s.total.toFixed(0)}
                        {totalTag > 0 && (
                          <span className="charts-legend-pct">
                            ({((s.total / totalTag) * 100).toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="charts-total">
                  <strong>Total: EGP {totalTag.toFixed(2)}</strong>
                </p>
              </>
            )}
          </section>

          {/* Daily spending */}
          <section className="charts-section charts-section--full">
            <h2 className="charts-section-title">Spending by day</h2>
            {dailyData.length === 0 ? (
              <p className="charts-section-empty">No daily data this month.</p>
            ) : (
              <div className="charts-bar-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dailyData}
                    margin={{ top: 8, right: 8, left: 8, bottom: 24 }}
                  >
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      angle={-45}
                      textAnchor="end"
                      height={40}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(v: number) => [`EGP ${v.toFixed(2)}`, 'Amount']}
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.date ? `Date: ${payload[0].payload.date}` : ''
                      }
                    />
                    <Bar dataKey="amount" name="Spent" fill="var(--mezan-accent)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Budget vs actual */}
          <section className="charts-section charts-section--full">
            <h2 className="charts-section-title">Budget vs actual by category</h2>
            {!budgetByCategory || budgetByCategory.items.length === 0 ? (
              <p className="charts-section-empty">
                No budget data. Set budgets per category in the Budgets page.
              </p>
            ) : (
              <div className="charts-bar-wrap charts-bar-wrap--tall">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={budgetBarData}
                    margin={{ top: 8, right: 8, left: 8, bottom: 60 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `EGP ${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(v: number) => [`EGP ${v.toFixed(2)}`, '']}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                    />
                    <Legend />
                    <Bar dataKey="budget" name="Budget" fill="var(--mezan-accent)" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="actual" name="Actual" fill="var(--mezan-success)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
