import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';

type SortBy = 'date' | 'merchant' | 'category' | 'amount';
type SortOrder = 'asc' | 'desc';

type Tag = { id: string; name: string; nameAr?: string | null };
type Category = { id: string; name: string; nameAr?: string | null };

type Transaction = {
  id: string;
  amount: number;
  currency: string;
  egp_value?: number | null;
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

function groupByDay<T extends { date: string }>(
  items: T[],
  dateOrder: 'desc' | 'asc' = 'desc'
): { date: string; items: T[] }[] {
  const byDay = new Map<string, T[]>();
  for (const t of items) {
    const d = t.date.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(t);
  }
  const groups = Array.from(byDay.entries()).map(([date, items]) => ({ date, items }));
  groups.sort((a, b) => (dateOrder === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  return groups;
}

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
  const [currency, setCurrency] = useState(transaction.currency || 'EGP');
  const [egpValue, setEgpValue] = useState(transaction.egp_value != null ? String(transaction.egp_value) : '');
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
      const egpNum = egpValue.trim() ? parseFloat(egpValue.trim()) : null;
      await api(`/v1/transactions/${transaction.id}`, {
        method: 'PATCH',
        token,
        body: {
          amount: amt,
          currency: currency || 'EGP',
          egp_value: egpNum != null && !Number.isNaN(egpNum) ? egpNum : null,
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
    <div className="tx-modal-backdrop" onClick={onClose} role="presentation">
      <div className="tx-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="tx-edit-title">
        <div className="tx-modal-header" id="tx-edit-title">Edit transaction</div>
        <form onSubmit={handleSubmit}>
          <div className="tx-modal-body">
            <label className="label">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <label className="label">Currency</label>
            <select
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="SAR">SAR</option>
              <option value="AED">AED</option>
              <option value="KWD">KWD</option>
            </select>
            {currency !== 'EGP' && (
              <>
                <label className="label">EGP value (optional)</label>
                <p style={{ margin: '-0.5rem 0 0.5rem', fontSize: '0.85rem', color: 'var(--mezan-text-muted)' }}>
                  Used in totals and budgets. Enter equivalent in EGP.
                </p>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input"
                  value={egpValue}
                  onChange={(e) => setEgpValue(e.target.value)}
                  placeholder="e.g. 35000"
                />
              </>
            )}
            <label className="label">Merchant</label>
            <input
              type="text"
              className="input"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
            <label className="label">Category</label>
            <select
              className="input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
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
            />
            <label className="label">Time</label>
            <input
              type="time"
              className="input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="tx-modal-footer">
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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [from, to] = range === 'all' ? ['2000-01-01', '2030-12-31'] : monthRange(month);

  const filteredAndSorted = useMemo(() => {
    let list = [...transactions];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const merchant = (t.merchant ?? '').toLowerCase();
        const category = (t.category?.name ?? '').toLowerCase();
        const tagNames = (t.tags ?? []).map((tag) => tag.name.toLowerCase()).join(' ');
        const amountStr = t.amount.toString();
        const dateStr = t.date;
        const egpStr = t.egp_value != null ? t.egp_value.toString() : '';
        return (
          merchant.includes(q) ||
          category.includes(q) ||
          tagNames.includes(q) ||
          amountStr.includes(q) ||
          dateStr.includes(q) ||
          egpStr.includes(q)
        );
      });
    }
    const mult = sortOrder === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'date':
          cmp = a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');
          break;
        case 'merchant':
          cmp = (a.merchant ?? '').localeCompare(b.merchant ?? '', undefined, { sensitivity: 'base' });
          break;
        case 'category':
          cmp = (a.category?.name ?? '').localeCompare(b.category?.name ?? '', undefined, { sensitivity: 'base' });
          break;
        case 'amount':
          cmp = (a.egp_value ?? a.amount) - (b.egp_value ?? b.amount);
          break;
        default:
          break;
      }
      return mult * cmp;
    });
    return list;
  }, [transactions, searchQuery, sortBy, sortOrder]);

  const groupedByDay = useMemo(
    () => groupByDay(filteredAndSorted, sortBy === 'date' && sortOrder === 'asc' ? 'asc' : 'desc'),
    [filteredAndSorted, sortBy, sortOrder]
  );

  function toggleSort(field: SortBy) {
    if (sortBy === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder(field === 'date' || field === 'amount' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ column }: { column: SortBy }) {
    if (sortBy !== column) return <span className="tx-sort-icon">↕</span>;
    return <span className="tx-sort-icon">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  }

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
      <header className="tx-header">
        <h1 className="page-title">Transactions</h1>
        <p className="page-subtitle">View and manage all transactions</p>
      </header>

      <div className="tx-toolbar">
        <div className="tx-segments">
          <button
            type="button"
            className={`tx-segment ${range === 'month' ? 'tx-segment--active' : ''}`}
            onClick={() => setRange('month')}
          >
            This month
          </button>
          <button
            type="button"
            className={`tx-segment ${range === 'all' ? 'tx-segment--active' : ''}`}
            onClick={() => setRange('all')}
          >
            All time
          </button>
        </div>
        {range === 'month' && (
          <div className="tx-month-wrap">
            <label className="label" htmlFor="tx-month">Month</label>
            <input
              id="tx-month"
              type="month"
              className="input tx-month-input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        )}
        <div className="tx-search-wrap">
          <label className="label" htmlFor="tx-search">Search</label>
          <input
            id="tx-search"
            type="search"
            className="input"
            placeholder="Merchant, category, amount…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {fixDatesMessage && <p className="tx-success">{fixDatesMessage}</p>}

      <div className="tx-bar">
        <span className="tx-count">
          {searchQuery.trim()
            ? `${filteredAndSorted.length} of ${transactions.length} transactions`
            : transactions.length === totalCount
              ? `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}${range === 'month' ? ' this month' : ''}`
              : `Showing ${transactions.length} of ${totalCount} transactions`}
        </span>
        <div className="tx-actions">
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '0.85rem' }}
            onClick={handleFixDates}
            disabled={fixDatesLoading}
          >
            {fixDatesLoading ? 'Fixing…' : 'Fix dates'}
          </button>
          <Link to="/add" className="btn btn-primary">
            Add transaction
          </Link>
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="tx-empty-card">
          <p className="tx-empty-text">
            {range === 'month' ? 'No transactions this month' : 'No transactions yet'}
          </p>
          <p className="tx-empty-muted">
            <Link to="/add">Add one</Link>, <Link to="/sms">paste from SMS</Link>, or{' '}
            <Link to="/sheet-merge">import from sheet</Link>.
          </p>
          {range === 'month' && (
            <>
              <p className="tx-empty-muted" style={{ marginTop: '0.75rem' }}>
                Switch to <strong>All time</strong> to see all transactions, or use <strong>Fix dates</strong> if imported data doesn’t show by month.
              </p>
              {dateRange && (
                <p className="tx-empty-muted" style={{ marginTop: '0.35rem' }}>
                  Your data spans <strong>{dateRange.min_date}</strong> to <strong>{dateRange.max_date}</strong>.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="tx-day-groups">
          {filteredAndSorted.length === 0 ? (
            <div className="tx-list-card">
              <p style={{ textAlign: 'center', padding: '2rem', margin: 0, color: 'var(--mezan-text-muted)' }}>
                No transactions match your search.
              </p>
            </div>
          ) : (
            groupedByDay.map(({ date, items }) => (
              <div key={date} className="tx-day-card">
                <header className="tx-day-card-header">
                  <span className="tx-day-card-title">{formatDayHeader(date)}</span>
                  <span className="tx-day-card-count">
                    {items.length} {items.length === 1 ? 'transaction' : 'transactions'}
                  </span>
                </header>
                <div className="tx-table-wrap">
                  <table className="tx-table">
                    <thead>
                      <tr>
                        <th
                          className="tx-th-sortable"
                          onClick={() => toggleSort('date')}
                          title="Sort by date"
                        >
                          Date <SortIcon column="date" />
                        </th>
                        <th
                          className="tx-th-sortable"
                          onClick={() => toggleSort('merchant')}
                          title="Sort by merchant"
                        >
                          Merchant <SortIcon column="merchant" />
                        </th>
                        <th
                          className="tx-th-sortable"
                          onClick={() => toggleSort('category')}
                          title="Sort by category"
                        >
                          Category <SortIcon column="category" />
                        </th>
                        <th
                          className="tx-th-sortable"
                          style={{ textAlign: 'right' }}
                          onClick={() => toggleSort('amount')}
                          title="Sort by amount"
                        >
                          Amount <SortIcon column="amount" />
                        </th>
                        <th style={{ width: 1 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((t) => (
                        <tr key={t.id}>
                          <td className="tx-td-date">
                            {t.date}{t.time ? ` · ${t.time}` : ''}
                          </td>
                          <td>
                            <span className="tx-td-merchant">{t.merchant || '—'}</span>
                            {(t.tags ?? []).length > 0 && (
                              <div className="tx-pills" style={{ marginTop: '0.35rem' }}>
                                {(t.tags ?? []).map((tag) => (
                                  <span key={tag.id} className="tx-pill tx-pill--tag">{tag.name}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            {t.category ? (
                              <span className="tx-pill tx-pill--cat">{t.category.name}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="tx-td-amount">
                            {t.amount.toFixed(2)} {t.currency}
                            {t.currency !== 'EGP' && t.egp_value != null && (
                              <span className="tx-td-amount-egp">
                                ≈ {Number(t.egp_value).toLocaleString(undefined, { minimumFractionDigits: 2 })} EGP
                              </span>
                            )}
                          </td>
                          <td className="tx-td-actions">
                            {deleteConfirmId === t.id ? (
                              <>
                                <span style={{ fontSize: '0.85rem', color: 'var(--mezan-text-muted)', marginRight: '0.25rem' }}>Delete?</span>
                                <button
                                  type="button"
                                  className="tx-btn-icon tx-btn-icon--danger"
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
                                  className="tx-btn-icon"
                                  onClick={() => setDeleteConfirmId(null)}
                                >
                                  No
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="tx-btn-icon"
                                  onClick={() => setEditingTransaction(t)}
                                  title="Edit"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="tx-btn-icon tx-btn-icon--danger"
                                  onClick={() => setDeleteConfirmId(t.id)}
                                  title="Delete"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
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
