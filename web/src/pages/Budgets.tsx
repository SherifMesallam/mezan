import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { getStoredToken } from '../App';

type BudgetRow = {
  id: string;
  scope_type: string;
  scope_id: string | null;
  amount: number;
  spent: number;
  remaining: number;
  overspent: boolean;
};

type BudgetByCategoryItem = {
  category_id: string;
  category_name: string;
  budget: number;
  actual: number;
  difference: number;
};

type Category = { id: string; name: string; parent_id?: string | null };
type Tag = { id: string; name: string };

export default function Budgets() {
  const token = getStoredToken();
  const [list, setList] = useState<BudgetRow[]>([]);
  const [byCategory, setByCategory] = useState<BudgetByCategoryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(currentMonth);
  const [scopeType, setScopeType] = useState<'total_monthly' | 'category' | 'sub_category' | 'tag'>('total_monthly');
  const [scopeId, setScopeId] = useState('');
  const [amount, setAmount] = useState('');
  const [editAmounts, setEditAmounts] = useState<Record<string, string>>({});

  const loadBudgets = useCallback(() => {
    if (!token) return;
    Promise.all([
      api<{ budgets: BudgetRow[] }>('/v1/budgets', { token, query: { month } }),
      api<{ items: BudgetByCategoryItem[] }>('/v1/insights/budget-by-category', { token, query: { month } }),
    ])
      .then(([budgetRes, byCatRes]) => {
        setList(budgetRes.budgets || []);
        const items = byCatRes.items || [];
        setByCategory(items);
        setEditAmounts((prev) => {
          const next = { ...prev };
          items.forEach((row) => {
            next[row.category_id] = String(row.budget);
          });
          return next;
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load budgets'));
  }, [token, month]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api<{ budgets: BudgetRow[] }>('/v1/budgets', { token, query: { month } }),
      api<{ items: BudgetByCategoryItem[] }>('/v1/insights/budget-by-category', { token, query: { month } }),
      api<{ categories: Category[] }>('/v1/categories', { token }),
      api<{ tags: Tag[] }>('/v1/tags', { token }),
    ])
      .then(([budgetRes, byCatRes, catRes, tagRes]) => {
        setList(budgetRes.budgets || []);
        const items = byCatRes.items || [];
        setByCategory(items);
        setCategories(catRes.categories || []);
        setTags(tagRes.tags || []);
        setEditAmounts((prev) => {
          const next = { ...prev };
          items.forEach((row) => {
            next[row.category_id] = String(row.budget);
          });
          return next;
        });
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, month]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (scopeType !== 'total_monthly' && !scopeId.trim()) {
      setError(scopeType === 'tag' ? 'Select a tag' : 'Select a category');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api('/v1/budgets', {
        method: 'POST',
        token: token!,
        body: {
          scope_type: scopeType,
          scope_id: scopeType === 'total_monthly' ? null : scopeId.trim(),
          amount: num,
          currency: 'EGP',
          month,
        },
      });
      setAmount('');
      setScopeId('');
      loadBudgets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set budget');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateCategoryBudget(categoryId: string) {
    const raw = editAmounts[categoryId];
    const num = parseFloat(raw ?? '0');
    if (Number.isNaN(num) || num < 0) {
      setError('Enter a valid amount');
      return;
    }
    setError('');
    setUpdatingId(categoryId);
    try {
      await api('/v1/budgets', {
        method: 'POST',
        token: token!,
        body: {
          scope_type: 'category',
          scope_id: categoryId,
          amount: num,
          currency: 'EGP',
          month,
        },
      });
      loadBudgets();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update budget');
    } finally {
      setUpdatingId(null);
    }
  }

  function scopeLabel(b: BudgetRow): string {
    if (b.scope_type === 'total_monthly') return 'Total monthly';
    if (b.scope_type === 'category' || b.scope_type === 'sub_category') {
      const cat = categories.find((c) => c.id === b.scope_id);
      return cat ? cat.name : (b.scope_id || '');
    }
    if (b.scope_type === 'tag') {
      const tag = tags.find((t) => t.id === b.scope_id);
      return tag ? tag.name : (b.scope_id || '');
    }
    return `${b.scope_type} ${b.scope_id}`;
  }

  const topLevelCategories = categories.filter((c) => !c.parent_id);
  const allCategoriesForScope = scopeType === 'sub_category' ? categories : topLevelCategories;

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <>
      <h1 className="page-title">Budgets</h1>
      <p className="page-subtitle">Month: {month}</p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Set budget</h2>
        <form onSubmit={handleSubmit}>
          <label className="label">Month</label>
          <input
            type="month"
            className="input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            required
          />
          <label className="label">Scope</label>
          <select
            className="input"
            value={scopeType}
            onChange={(e) => {
              setScopeType(e.target.value as typeof scopeType);
              setScopeId('');
            }}
          >
            <option value="total_monthly">Total monthly</option>
            <option value="category">By category (top-level)</option>
            <option value="sub_category">By category (any)</option>
            <option value="tag">By tag</option>
          </select>
          {scopeType !== 'total_monthly' && (
            <>
              <label className="label">
                {scopeType === 'tag' ? 'Tag' : 'Category'}
              </label>
              <select
                className="input"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                required={scopeType === 'category' || scopeType === 'tag' || scopeType === 'sub_category'}
              >
                <option value="">— Select —</option>
                {scopeType === 'tag'
                  ? tags.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))
                  : allCategoriesForScope.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
              </select>
            </>
          )}
          <label className="label">Amount (EGP)</label>
          <input
            type="number"
            className="input"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 5000"
            required
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={saving}>
            {saving ? 'Saving…' : 'Set budget'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem', overflowX: 'auto' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Summary by Category</h2>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#666' }}>
          Set or change the budget for each category below. Click Update to save.
        </p>
        {byCategory.length === 0 ? (
          <p style={{ margin: 0, color: '#666', fontSize: '0.9rem' }}>No categories. Add categories first.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem 0.5rem 0' }}>Category</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Budget (EGP)</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Actual</th>
                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Difference</th>
                <th style={{ padding: '0.5rem 0 0.5rem 0.75rem', width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {byCategory.map((row) => (
                <tr key={row.category_id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.5rem 0.75rem 0.5rem 0' }}>{row.category_name}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input"
                      style={{ width: 100, textAlign: 'right', padding: '0.35rem 0.5rem' }}
                      value={editAmounts[row.category_id] ?? row.budget}
                      onChange={(e) => setEditAmounts((prev) => ({ ...prev, [row.category_id]: e.target.value }))}
                    />
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>EGP {row.actual.toFixed(2)}</td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: row.difference >= 0 ? '#2e7d32' : '#c62828' }}>
                    EGP {row.difference.toFixed(2)}
                  </td>
                  <td style={{ padding: '0.5rem 0 0.5rem 0.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem' }}
                      onClick={() => handleUpdateCategoryBudget(row.category_id)}
                      disabled={updatingId === row.category_id}
                    >
                      {updatingId === row.category_id ? '…' : 'Update'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {list.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, color: '#666' }}>No budgets set for this month. Set one above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {list.map((b) => (
            <div
              key={b.id}
              className="card"
              style={b.overspent ? { backgroundColor: 'rgba(198, 40, 40, 0.08)' } : undefined}
            >
              <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>{scopeLabel(b)}</p>
              <div className="progress-wrap">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.min(100, (b.spent / (b.amount || 1)) * 100)}%` }}
                />
              </div>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#666' }}>
                EGP {b.spent.toFixed(2)} / {b.amount.toFixed(2)}
                {b.overspent ? ' (over)' : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
