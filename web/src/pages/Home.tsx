import { useState, useEffect } from 'react';
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

const PIE_COLORS = [
  '#2196F3', '#E91E63', '#795548', '#9E9E9E', '#FF9800', '#4CAF50', '#607D8B',
  '#00BCD4', '#FF5722', '#3F51B5', '#009688', '#8BC34A', '#03A9F4', '#CDDC39',
];

function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [start, end];
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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus[]>([]);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [budgetByCategory, setBudgetByCategory] = useState<{
    items: BudgetByCategoryItem[];
    total_budget: number;
    total_actual: number;
    total_difference: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const [from, to] = useAllTime ? ['2000-01-01', '2030-12-31'] : useDateRange ? [dateFrom, dateTo] : monthRange(month);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
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
      }>('/v1/insights/budget-by-category', { token, query: { month } }),
    ])
      .then(([txRes, catRes, budgetRes, summaryRes, byCatRes]) => {
        setTransactions(txRes.transactions || []);
        setCategories(catRes.categories || []);
        setBudgetStatus(budgetRes.budget_status || []);
        setSummary(summaryRes.summary || []);
        setBudgetByCategory(byCatRes);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, month, from, to, refreshCounter]);

  const nameById = Object.fromEntries((budgetByCategory?.items || []).map((r) => [r.category_id, r.category_name]));
  const categoryNameById = Object.fromEntries(categories.map((c) => [c.id, c.name]));
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

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <>
      <h1 className="page-title">Home</h1>
      <p className="page-subtitle">Monthly budget dashboard</p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useAllTime}
              onChange={(e) => {
                setUseAllTime(e.target.checked);
                if (e.target.checked) setUseDateRange(false);
              }}
            />
            <span>All time</span>
          </label>
          {!useAllTime && (
            <>
              <div>
                <label className="label">Month</label>
                <input
                  type="month"
                  className="input"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  style={{ maxWidth: 160 }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useDateRange}
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (on) {
                      const [f, t] = monthRange(month);
                      setDateFrom(f);
                      setDateTo(t);
                    }
                    setUseDateRange(on);
                  }}
                />
                <span>Custom date range</span>
              </label>
            </>
          )}
          {!useAllTime && useDateRange && (
            <>
              <div>
                <label className="label">From</label>
                <input
                  type="date"
                  className="input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{ maxWidth: 140 }}
                />
              </div>
              <div>
                <label className="label">To</label>
                <input
                  type="date"
                  className="input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{ maxWidth: 140 }}
                />
              </div>
            </>
          )}
        </div>
        {useAllTime && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#666' }}>
            Showing all transactions and spending. Budget goals below use the current month.
          </p>
        )}
        {!useAllTime && useDateRange && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#666' }}>
            Transactions and summary use this range. Budget goals use the month above.
          </p>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ minHeight: 280 }}>
          <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0', fontWeight: 600 }}>Actual Summary</h2>
          {pieData.length === 0 ? (
            <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>No spending this month.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => (percent >= 0.03 ? `${name} ${(percent * 100).toFixed(0)}%` : '')}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={pieData[i].color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `EGP ${v.toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card" style={{ minHeight: 280 }}>
          <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0', fontWeight: 600 }}>Budget vs. Actual</h2>
          {barData.length === 0 ? (
            <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>No categories or data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 8, bottom: 60 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `EGP ${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number) => [`EGP ${v.toFixed(2)}`, '']}
                  labelFormatter={(_, payload) => payload[0]?.payload?.fullName ?? ''}
                />
                <Legend />
                <Bar dataKey="budget" name="Budget" fill="#2196F3" radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill="#4CAF50" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h2 style={{ fontSize: '0.95rem', margin: '0 0 0.75rem 0', fontWeight: 600 }}>Summary by Category</h2>
        {!budgetByCategory || budgetByCategory.items.length === 0 ? (
          <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>
            No categories. <Link to="/categories">Add categories</Link> and <Link to="/budgets">set budgets</Link>.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem 0.5rem 0' }}>Category</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Budget</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Actual</th>
                <th style={{ padding: '0.5rem 0 0.5rem 0.75rem', textAlign: 'right' }}>Difference</th>
              </tr>
            </thead>
            <tbody>
              {budgetByCategory.items.map((row) => (
                <tr key={row.category_id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.5rem 0.75rem 0.5rem 0' }}>{row.category_name}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>EGP {row.budget.toFixed(2)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>EGP {row.actual.toFixed(2)}</td>
                  <td style={{ padding: '0.5rem 0 0.5rem 0.75rem', textAlign: 'right', color: row.difference >= 0 ? '#2e7d32' : '#c62828' }}>
                    EGP {row.difference.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid #e0e0e0', fontWeight: 700 }}>
                <td style={{ padding: '0.75rem 0.75rem 0.75rem 0' }}>Total</td>
                <td style={{ padding: '0.75rem 0.75rem', textAlign: 'right' }}>EGP {budgetByCategory.total_budget.toFixed(2)}</td>
                <td style={{ padding: '0.75rem 0.75rem', textAlign: 'right' }}>EGP {budgetByCategory.total_actual.toFixed(2)}</td>
                <td style={{ padding: '0.75rem 0 0.75rem 0.75rem', textAlign: 'right', color: budgetByCategory.total_difference >= 0 ? '#2e7d32' : '#c62828' }}>
                  EGP {budgetByCategory.total_difference.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {budgetStatus.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Budget progress</h2>
            <Link to="/budgets">Set budgets</Link>
          </div>
          {budgetStatus.map((b) => (
            <div
              key={`${b.scope_type}-${b.scope_id || 'total'}`}
              className="card"
              style={{ marginTop: '0.5rem', ...(b.overspent ? { backgroundColor: 'rgba(198, 40, 40, 0.08)' } : {}) }}
            >
              <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>
                {b.scope_type === 'total_monthly'
                  ? 'Total monthly'
                  : (b.scope_type === 'category' || b.scope_type === 'sub_category') && b.scope_id
                    ? (categoryNameById[b.scope_id] ?? b.scope_id)
                    : `${b.scope_type}${b.scope_id ? `: ${b.scope_id}` : ''}`}
              </p>
              <div className="progress-wrap">
                <div className="progress-bar" style={{ width: `${Math.min(100, (b.spent / (b.amount || 1)) * 100)}%` }} />
              </div>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#666' }}>
                EGP {b.spent.toFixed(2)} / {b.amount.toFixed(2)}
                {b.overspent ? ' (over)' : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Recent transactions</h2>
        <span style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/transactions">View all</Link>
          <Link to="/add">Add</Link>
        </span>
      </div>
      {transactions.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, color: '#666' }}>No transactions this month. <Link to="/add">Add one</Link> or <Link to="/sms">paste from SMS</Link>.</p>
        </div>
      ) : (
        <ul className="list">
          {transactions.slice(0, 5).map((t) => (
            <li key={t.id} className="list-item" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="list-item-main" style={{ flex: 1, minWidth: 0 }}>
                <strong>{t.merchant || t.category?.name || '—'}</strong>
                <span style={{ fontSize: '0.9rem', color: '#666' }}>{t.date}</span>
              </span>
              <span className="list-item-amount">{t.currency} {t.amount.toFixed(2)}</span>
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
                    className="btn"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', color: '#c62828' }}
                    onClick={() => setDeleteConfirmId(t.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {transactions.length > 5 && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
          <Link to="/transactions">View all {transactions.length} transactions →</Link>
        </p>
      )}

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
