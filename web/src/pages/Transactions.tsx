import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';

type Tag = { id: string; name: string; nameAr?: string | null };
type Category = { id: string; name: string; nameAr?: string | null };

type Transaction = {
  id: string;
  amount: number;
  currency: string;
  date: string;
  time: string | null;
  merchant: string | null;
  category_id: string;
  category: Category | null;
  tag_ids?: string[];
  tags: Tag[];
};

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
  tags,
  token,
  saving,
  onClose,
  onSaved,
  onError,
  setSaving,
}: {
  transaction: Transaction;
  categories: Category[];
  tags: Tag[];
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
  const [tagIds, setTagIds] = useState<string[]>(transaction.tag_ids ?? transaction.tags?.map((t) => t.id) ?? []);

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

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
          tag_ids: tagIds,
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
          <label className="label">Amount</label>
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
          {tags.length > 0 && (
            <>
              <label className="label">Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {tags.map((t) => (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <input
                      type="checkbox"
                      checked={tagIds.includes(t.id)}
                      onChange={() => toggleTag(t.id)}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </>
          )}
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

export default function Transactions() {
  const token = getStoredToken();
  const location = useLocation();
  const state = location.state as { focusMonth?: string; showAll?: boolean } | null;
  const focusMonth = state?.focusMonth;
  const showAll = state?.showAll === true;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(focusMonth || currentMonth);
  const [range, setRange] = useState<'month' | 'all'>(showAll ? 'all' : 'all');

  useEffect(() => {
    if (focusMonth) setMonth(focusMonth);
  }, [focusMonth]);
  useEffect(() => {
    if (showAll) setRange('all');
  }, [showAll]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fixDatesLoading, setFixDatesLoading] = useState(false);
  const [fixDatesMessage, setFixDatesMessage] = useState<string | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [dateRange, setDateRange] = useState<{ min_date: string; max_date: string; total_count: number } | null>(null);

  const [from, to] = range === 'all' ? ['2000-01-01', '2030-12-31'] : monthRange(month);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    Promise.all([
      api<{ transactions: Transaction[]; total_count?: number }>('/v1/transactions', {
        token,
        query: { from, to, limit: '2000' },
      }),
      api<{ categories: Category[] }>('/v1/categories', { token }),
      api<{ tags: Tag[] }>('/v1/tags', { token }),
    ])
      .then(([txRes, catRes, tagRes]) => {
        setTransactions(txRes.transactions || []);
        setTotalCount(typeof txRes.total_count === 'number' ? txRes.total_count : txRes.transactions?.length ?? 0);
        setCategories(catRes.categories || []);
        setTags(tagRes.tags || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, from, to, refreshCounter]);

  useEffect(() => {
    setFixDatesMessage(null);
  }, [from, to]);

  useEffect(() => {
    if (!token || range !== 'month' || transactions.length > 0) {
      setDateRange(null);
      return;
    }
    api<{ min_date: string | null; max_date: string | null; total_count: number }>('/v1/transactions/date-range', {
      token,
    })
      .then((r) => {
        if (r.total_count > 0 && r.min_date && r.max_date) {
          setDateRange({ min_date: r.min_date, max_date: r.max_date, total_count: r.total_count });
        } else {
          setDateRange(null);
        }
      })
      .catch(() => setDateRange(null));
  }, [token, range, transactions.length, refreshCounter]);

  async function handleFixDates() {
    if (!token) return;
    setFixDatesLoading(true);
    setError('');
    setFixDatesMessage(null);
    try {
      const res = await api<{ updated: number; skipped: number; total_checked: number }>(
        '/v1/transactions/fix-dates',
        { method: 'POST', token }
      );
      if (res.updated > 0) {
        setRefreshCounter((c) => c + 1);
      }
      setFixDatesMessage(
        res.updated > 0
          ? `Fixed ${res.updated} transaction date(s). List refreshed.`
          : res.total_checked === 0
            ? 'No transactions to check.'
            : 'All transaction dates were already in the correct format.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fix dates');
    } finally {
      setFixDatesLoading(false);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <>
      <h1 className="page-title">Transactions</h1>
      <p className="page-subtitle">View and manage all transactions</p>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
        <div>
          <label className="label">Range</label>
          <select
            className="input"
            value={range}
            onChange={(e) => setRange(e.target.value as 'month' | 'all')}
            style={{ minWidth: 120 }}
          >
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </div>
        {range === 'month' && (
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
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {fixDatesMessage && <p style={{ margin: 0, color: 'var(--success, #0a0)', fontSize: '0.9rem' }}>{fixDatesMessage}</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.9rem', color: '#666' }}>
          {transactions.length === totalCount
            ? `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}${range === 'month' ? ' this month' : ''}`
            : `Showing ${transactions.length} of ${totalCount} transactions`}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.85rem' }}
            onClick={handleFixDates}
            disabled={fixDatesLoading}
          >
            {fixDatesLoading ? 'Fixing…' : 'Fix dates if missing'}
          </button>
          <Link to="/add">Add transaction</Link>
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0, color: '#666' }}>
            {range === 'month'
              ? 'No transactions this month. '
              : 'No transactions. '}
            <Link to="/add">Add one</Link>, <Link to="/sms">paste from SMS</Link>, or{' '}
            <Link to="/sheet-merge">import from sheet</Link>.
          </p>
          {range === 'month' && (
            <>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#666' }}>
                Switch to <strong>All time</strong> above to see all transactions, or click <strong>Fix dates if missing</strong> if you imported data that doesn’t show by month.
              </p>
              {dateRange && (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#666' }}>
                  Your transactions span <strong>{dateRange.min_date}</strong> to <strong>{dateRange.max_date}</strong>. Pick a month in that range or use All time.
                </p>
              )}
            </>
          )}
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.9rem', color: '#666' }}>
            If you imported transactions that match when you re-paste the CSV but they don’t appear here, their dates may be in the wrong format. Click <strong>Fix dates if missing</strong> above to normalize them.
          </p>
        </div>
      ) : (
        <ul className="list">
          {transactions.map((t) => (
            <li key={t.id} className="list-item" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className="list-item-main" style={{ flex: 1, minWidth: 0 }}>
                  <strong>{t.merchant || t.category?.name || '—'}</strong>
                  <span style={{ fontSize: '0.9rem', color: '#666', marginLeft: '0.5rem' }}>
                    {t.date}{t.time ? ` ${t.time}` : ''}
                  </span>
                </span>
                <span className="list-item-amount">
                  {t.currency} {t.amount.toFixed(2)}
                </span>
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
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                {t.category && (
                  <span
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 4,
                      background: '#e3f2fd',
                      color: '#1565c0',
                    }}
                  >
                    {t.category.name}
                  </span>
                )}
                {(t.tags ?? []).map((tag) => (
                  <span
                    key={tag.id}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 4,
                      background: '#f3e5f5',
                      color: '#7b1fa2',
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingTransaction && (
        <EditTransactionModal
          transaction={editingTransaction}
          categories={categories}
          tags={tags}
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
