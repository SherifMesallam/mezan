import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';

type PreviewItem = {
  sheet_index: number;
  amount: number;
  currency: string;
  date: string;
  category_name: string;
  merchant: string | null;
  raw_line?: string | null;
  matched_entry_id: string | null;
  matched_entry: {
    id: string;
    amount: number;
    date: string;
    category_name: string;
    merchant: string | null;
  } | null;
};

type Action = 'skip' | 'add_new' | 'discard';

type Category = { id: string; name: string };
type Tag = { id: string; name: string };

type ExistingTransaction = {
  id: string;
  amount: number;
  currency: string;
  date: string;
  merchant: string | null;
  category: { id: string; name: string } | null;
};

type MatchedEntry = {
  id: string;
  amount: number;
  date: string;
  category_name: string;
  merchant: string | null;
};

export default function MergeFromSheet() {
  const token = getStoredToken();
  const [sheetText, setSheetText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewItems, setPreviewItems] = useState<PreviewItem[] | null>(null);
  const [actionByIndex, setActionByIndex] = useState<Record<number, Action>>({});
  const [merchantByIndex, setMerchantByIndex] = useState<Record<number, string>>({});
  const [categoryIdByIndex, setCategoryIdByIndex] = useState<Record<number, string>>({});
  const [tagIdsByIndex, setTagIdsByIndex] = useState<Record<number, string[]>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [manualMatchByIndex, setManualMatchByIndex] = useState<Record<number, MatchedEntry>>({});
  const [pickerForSheetIndex, setPickerForSheetIndex] = useState<number | null>(null);
  const [pickerTransactions, setPickerTransactions] = useState<ExistingTransaction[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [viewPopupEntry, setViewPopupEntry] = useState<MatchedEntry | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    discarded?: number;
    date_range?: { min_date: string; max_date: string } | null;
    total_transactions_for_user?: number;
    sample_dates_from_db?: string[];
  } | null>(null);

  async function handleParseAndMatch() {
    if (!token) return;
    const raw = sheetText.trim();
    if (!raw) {
      setError('Paste your sheet content first (CSV or table data).');
      return;
    }
    setError('');
    setPreviewItems(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await api<{ items: PreviewItem[] }>('/v1/import/sheet-merge-preview', {
        method: 'POST',
        token,
        body: { sheet_text: raw },
      });
      const items = res.items ?? [];
      setPreviewItems(items);
      setManualMatchByIndex({});
      const initial: Record<number, Action> = {};
      items.forEach((it) => {
        initial[it.sheet_index] = it.matched_entry_id ? 'skip' : 'add_new';
      });
      setActionByIndex(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse or match sheet');
    } finally {
      setLoading(false);
    }
  }

  function setAction(sheetIndex: number, action: Action) {
    setActionByIndex((prev) => ({ ...prev, [sheetIndex]: action }));
  }

  function openMatchPicker(sheetIndex: number) {
    setPickerForSheetIndex(sheetIndex);
    setPickerTransactions([]);
    setPickerLoading(true);
    setError('');
  }

  async function loadPickerTransactions() {
    if (!token || pickerForSheetIndex == null) return;
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().slice(0, 10);
    try {
      const res = await api<{ transactions: ExistingTransaction[] }>('/v1/transactions', {
        token,
        query: { from, to, limit: '300' },
      });
      setPickerTransactions(res.transactions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions');
    } finally {
      setPickerLoading(false);
    }
  }

  function selectManualMatch(tx: ExistingTransaction) {
    if (pickerForSheetIndex == null) return;
    const entry: MatchedEntry = {
      id: tx.id,
      amount: tx.amount,
      date: tx.date,
      category_name: tx.category?.name ?? '',
      merchant: tx.merchant,
    };
    setManualMatchByIndex((prev) => ({ ...prev, [pickerForSheetIndex]: entry }));
    setActionByIndex((prev) => ({ ...prev, [pickerForSheetIndex]: 'skip' }));
    setPickerForSheetIndex(null);
  }

  useEffect(() => {
    if (pickerForSheetIndex != null && token) loadPickerTransactions();
  }, [pickerForSheetIndex, token]);

  useEffect(() => {
    if (!token || !previewItems?.length) return;
    Promise.all([
      api<{ categories: Category[] }>('/v1/categories', { token }),
      api<{ tags: Tag[] }>('/v1/tags', { token }),
    ]).then(([cRes, tRes]) => {
      setCategories(cRes.categories ?? []);
      setTags(tRes.tags ?? []);
    });
  }, [token, previewItems?.length]);

  async function handleConfirm() {
    if (!previewItems || previewItems.length === 0) return;
    if (!token) {
      setError('Please log in again.');
      return;
    }
    setError('');
    setConfirming(true);
    try {
      const items = previewItems.map((it) => {
        const action = actionByIndex[it.sheet_index] ?? getDefaultAction(it);
        const base = { sheet_index: it.sheet_index, action };
        const tagIds = tagIdsByIndex[it.sheet_index];
        if (action === 'discard') {
          return base;
        }
        if (action === 'add_new') {
          const categoryId = categoryIdByIndex[it.sheet_index];
          const merchant = merchantByIndex[it.sheet_index] !== undefined ? (merchantByIndex[it.sheet_index]?.trim() || null) : it.merchant;
          return {
            ...base,
            amount: it.amount,
            date: it.date,
            category_name: it.category_name,
            merchant,
            currency: it.currency,
            ...(categoryId ? { category_id: categoryId } : {}),
            ...(Array.isArray(tagIds) && tagIds.length > 0 ? { tag_ids: tagIds } : {}),
          };
        }
        const displayMatch = getDisplayMatch(it);
        return {
          ...base,
          ...(displayMatch ? { matched_entry_id: displayMatch.id } : {}),
          ...(Array.isArray(tagIds) && tagIds.length > 0 ? { tag_ids: tagIds } : {}),
        };
      });
      const res = await api<{
        created: { id: string }[];
        count: number;
        skipped: number;
        discarded?: number;
        date_range?: { min_date: string; max_date: string } | null;
        total_transactions_for_user?: number;
        sample_dates_from_db?: string[];
      }>('/v1/import/sheet-merge-confirm', { method: 'POST', token, body: { items } });
      setResult({
        created: res.count ?? 0,
        skipped: res.skipped ?? 0,
        discarded: res.discarded ?? 0,
        date_range: res.date_range ?? null,
        total_transactions_for_user: res.total_transactions_for_user,
        sample_dates_from_db: res.sample_dates_from_db,
      });
      setPreviewItems(null);
      setSheetText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create transactions');
    } finally {
      setConfirming(false);
    }
  }

  function getDisplayMatch(it: PreviewItem): MatchedEntry | null {
    const manual = manualMatchByIndex[it.sheet_index];
    if (manual) return manual;
    return it.matched_entry;
  }

  function getDefaultAction(it: PreviewItem): Action {
    if (manualMatchByIndex[it.sheet_index] || it.matched_entry_id) return 'skip';
    return 'add_new';
  }

  function setMerchant(sheetIndex: number, value: string) {
    setMerchantByIndex((prev) => ({ ...prev, [sheetIndex]: value }));
  }

  function setCategory(sheetIndex: number, categoryId: string) {
    setCategoryIdByIndex((prev) => ({ ...prev, [sheetIndex]: categoryId }));
  }

  function toggleTag(sheetIndex: number, tagId: string) {
    setTagIdsByIndex((prev) => {
      const cur = prev[sheetIndex] ?? [];
      const next = cur.includes(tagId) ? cur.filter((id) => id !== tagId) : [...cur, tagId];
      return next.length ? { ...prev, [sheetIndex]: next } : { ...prev, [sheetIndex]: [] };
    });
  }

  const addNewCount = previewItems
    ? previewItems.filter((it) => (actionByIndex[it.sheet_index] ?? getDefaultAction(it)) === 'add_new').length
    : 0;

  return (
    <>
      <h1 className="page-title">Merge import from sheet</h1>
      <p className="page-subtitle">
        Paste data from a spreadsheet (CSV or table). We’ll match rows to existing transactions and let you confirm or add as new.
      </p>

      {result != null && (
        <div className="card" style={{ marginBottom: '1rem', backgroundColor: 'rgba(76, 175, 80, 0.1)' }}>
          <p style={{ margin: 0 }}>
            <strong>Done.</strong>{' '}
            {result.created === 0 && result.skipped === 0 && (result.discarded ?? 0) === 0
              ? 'No changes.'
              : [
                  result.created > 0 && `${result.created} added`,
                  result.skipped > 0 && `${result.skipped} matched`,
                  (result.discarded ?? 0) > 0 && `${result.discarded} discarded`,
                ].filter(Boolean).join(', ') + '.'}
          </p>
          {typeof result.total_transactions_for_user === 'number' && (
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: '#555' }}>
              Your account now has <strong>{result.total_transactions_for_user} transaction(s)</strong> in total.
              {result.sample_dates_from_db && result.sample_dates_from_db.length > 0 && (
                <> Sample dates stored: {result.sample_dates_from_db.slice(0, 5).join(', ')}.</>
              )}
            </p>
          )}
          {result.date_range && result.created > 0 && (
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: '#555' }}>
              Date range: {result.date_range.min_date} to {result.date_range.max_date}. Use “This month” and pick that month, or use <strong>All time</strong> to see everything.
            </p>
          )}
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
            <Link to="/transactions" state={{ showAll: true }}>
              View all transactions
            </Link>
            {result.date_range && (
              <>
                {' · '}
                <Link to="/transactions" state={{ focusMonth: result.date_range.min_date.slice(0, 7) }}>
                  View that month
                </Link>
              </>
            )}
            {' · '}
            <Link to="/" state={result.date_range ? { focusMonth: result.date_range.min_date.slice(0, 7) } : undefined}>
              Home
            </Link>
          </p>
        </div>
      )}

      {!previewItems ? (
        <div className="card">
          <label className="label">Sheet content (paste CSV or table)</label>
          <textarea
            className="input"
            value={sheetText}
            onChange={(e) => setSheetText(e.target.value)}
            placeholder="Date, Amount, Category, Merchant&#10;2025-01-15, 790, Groceries, Market&#10;2025-01-16, 50, Transport, Uber"
            rows={12}
            style={{ fontFamily: 'monospace', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' }}
          />
          {error && <p className="error" style={{ marginTop: '0.5rem' }}>{error}</p>}
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: '0.75rem' }}
            onClick={handleParseAndMatch}
            disabled={loading}
          >
            {loading ? 'Parsing & matching…' : 'Parse & match'}
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.95rem' }}>
              {previewItems.length} row(s) from sheet. Change action per row, then confirm.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setPreviewItems(null); setResult(null); setPickerForSheetIndex(null); }}
            >
              Paste again
            </button>
          </div>

          {error && <p className="error" style={{ marginBottom: '0.75rem' }}>{error}</p>}

          <div className="card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0.75rem 0.5rem 0' }}>From sheet</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Matched existing</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Action</th>
                  <th style={{ padding: '0.5rem 0.75rem' }}>Category</th>
                  <th style={{ padding: '0.5rem 0 0.5rem 0.75rem' }}>Tags</th>
                </tr>
              </thead>
              <tbody>
                {previewItems.map((it) => {
                  const displayMatch = getDisplayMatch(it);
                  const action = actionByIndex[it.sheet_index] ?? getDefaultAction(it);
                  return (
                    <tr key={it.sheet_index} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '0.5rem 0.75rem 0.5rem 0', verticalAlign: 'top' }}>
                        {it.raw_line && (
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: '#666',
                              fontFamily: 'monospace',
                              background: '#f5f5f5',
                              padding: '0.25rem 0.4rem',
                              borderRadius: 4,
                              marginBottom: '0.35rem',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxWidth: 320,
                            }}
                            title="Pasted line from sheet"
                          >
                            {it.raw_line}
                          </div>
                        )}
                        <div>
                          <strong>{it.currency} {it.amount.toFixed(2)}</strong> · {it.date}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#555' }}>
                          {it.category_name}
                          {(merchantByIndex[it.sheet_index] ?? it.merchant) ? ` · ${merchantByIndex[it.sheet_index] ?? it.merchant}` : ''}
                        </div>
                        <label style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.8rem', color: '#555' }}>
                          Merchant:{' '}
                          <input
                            type="text"
                            className="input"
                            style={{ fontSize: '0.85rem', padding: '0.25rem 0.4rem', width: '100%', maxWidth: 200 }}
                            value={merchantByIndex[it.sheet_index] ?? it.merchant ?? ''}
                            onChange={(e) => setMerchant(it.sheet_index, e.target.value)}
                            placeholder="Edit merchant"
                          />
                        </label>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'top' }}>
                        {displayMatch ? (
                          <div>
                            <div>{displayMatch.amount.toFixed(2)} · {displayMatch.date}</div>
                            <div style={{ fontSize: '0.85rem', color: '#555' }}>
                              {displayMatch.category_name}
                              {displayMatch.merchant ? ` · ${displayMatch.merchant}` : ''}
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', marginTop: '0.25rem' }}
                              onClick={() => setViewPopupEntry(displayMatch)}
                            >
                              View
                            </button>
                            {manualMatchByIndex[it.sheet_index] && (
                              <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: '#666' }}>(manual)</span>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <span style={{ color: '#888' }}>— No match</span>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', alignSelf: 'flex-start' }}
                              onClick={() => openMatchPicker(it.sheet_index)}
                            >
                              Match to a transaction
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'top' }}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button
                              type="button"
                              className={action === 'skip' ? 'btn btn-primary' : 'btn btn-secondary'}
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                              onClick={() => setAction(it.sheet_index, 'skip')}
                            >
                              Confirm match
                            </button>
                            <button
                              type="button"
                              className={action === 'add_new' ? 'btn btn-primary' : 'btn btn-secondary'}
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                              onClick={() => setAction(it.sheet_index, 'add_new')}
                            >
                              Add as new
                            </button>
                            <button
                              type="button"
                              className={action === 'discard' ? 'btn btn-primary' : 'btn btn-secondary'}
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                              onClick={() => setAction(it.sheet_index, 'discard')}
                            >
                              Discard
                            </button>
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#666' }}>
                            {action === 'discard'
                              ? '✓ Row will be ignored'
                              : action === 'skip'
                                ? '✓ Will not create (matched to existing)'
                                : '✓ Will create as new transaction'}
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'top' }}>
                        {action === 'add_new' && categories.length > 0 ? (
                          <select
                            className="input"
                            style={{ fontSize: '0.85rem', padding: '0.3rem 0.5rem', minWidth: 120 }}
                            value={categoryIdByIndex[it.sheet_index] ?? categories.find((c) => c.name === it.category_name)?.id ?? categories[0]?.id ?? ''}
                            onChange={(e) => setCategory(it.sheet_index, e.target.value)}
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: '#999', fontSize: '0.85rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem 0 0.5rem 0.75rem', verticalAlign: 'top' }}>
                        {tags.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {tags.map((tag) => {
                              const selected = (tagIdsByIndex[it.sheet_index] ?? []).includes(tag.id);
                              return (
                                <label key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleTag(it.sheet_index, tag.id)}
                                  />
                                  <span>{tag.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <span style={{ color: '#999', fontSize: '0.85rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              disabled={confirming}
            >
              {confirming
                ? 'Processing…'
                : addNewCount > 0
                  ? `Confirm and add ${addNewCount} as new`
                  : 'Confirm (all matched — no new transactions)'}
            </button>
            {addNewCount === 0 && previewItems.length > 0 && (
              <span style={{ fontSize: '0.9rem', color: '#666' }}>
                All rows are “Confirm match”. Click the button above to finish, or switch any row to “Add as new” to create it.
              </span>
            )}
          </div>
        </>
      )}

      {viewPopupEntry != null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}
          onClick={() => setViewPopupEntry(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 360, width: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem' }}>Transaction</h3>
            <dl style={{ margin: 0, fontSize: '0.95rem' }}>
              <dt style={{ margin: '0.35rem 0 0 0', fontWeight: 600, color: '#555' }}>Amount</dt>
              <dd style={{ margin: '0.15rem 0 0 0' }}>{viewPopupEntry.amount.toFixed(2)}</dd>
              <dt style={{ margin: '0.5rem 0 0 0', fontWeight: 600, color: '#555' }}>Date</dt>
              <dd style={{ margin: '0.15rem 0 0 0' }}>{viewPopupEntry.date}</dd>
              <dt style={{ margin: '0.5rem 0 0 0', fontWeight: 600, color: '#555' }}>Category</dt>
              <dd style={{ margin: '0.15rem 0 0 0' }}>{viewPopupEntry.category_name || '—'}</dd>
              <dt style={{ margin: '0.5rem 0 0 0', fontWeight: 600, color: '#555' }}>Merchant</dt>
              <dd style={{ margin: '0.15rem 0 0 0' }}>{viewPopupEntry.merchant || '—'}</dd>
            </dl>
            <p style={{ margin: '1rem 0 0 0', fontSize: '0.85rem' }}>
              <a href="/transactions" target="_blank" rel="noopener noreferrer">Open transactions page in new tab</a>
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '0.75rem' }}
              onClick={() => setViewPopupEntry(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {pickerForSheetIndex != null && (
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
          onClick={() => setPickerForSheetIndex(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 520, width: '95%', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem' }}>Match to a transaction</h3>
            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#666' }}>
              Choose the existing transaction that matches this sheet row.
            </p>
            {pickerLoading ? (
              <p style={{ margin: 0, color: '#666' }}>Loading transactions…</p>
            ) : pickerTransactions.length === 0 ? (
              <p style={{ margin: 0, color: '#666' }}>No transactions found.</p>
            ) : (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  overflow: 'auto',
                  flex: 1,
                  border: '1px solid #eee',
                  borderRadius: 8,
                }}
              >
                {pickerTransactions.map((tx) => (
                  <li
                    key={tx.id}
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                    }}
                    onClick={() => selectManualMatch(tx)}
                    onKeyDown={(e) => e.key === 'Enter' && selectManualMatch(tx)}
                    role="button"
                    tabIndex={0}
                  >
                    <div><strong>{tx.currency} {tx.amount.toFixed(2)}</strong> · {tx.date}</div>
                    <div style={{ fontSize: '0.85rem', color: '#555' }}>
                      {tx.category?.name ?? '—'}
                      {tx.merchant ? ` · ${tx.merchant}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '0.75rem' }}
              onClick={() => setPickerForSheetIndex(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
        <Link to="/transactions">← Transactions</Link> · <Link to="/add">Add transaction</Link>
      </p>
    </>
  );
}
