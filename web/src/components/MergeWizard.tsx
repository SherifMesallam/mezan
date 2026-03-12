import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export type MatchedEntry = {
  id: string;
  amount: number;
  date: string;
  category_name: string;
  merchant: string | null;
};

export type MergePreviewItem = {
  sheet_index: number;
  amount: number;
  currency: string;
  date: string;
  time: string | null;
  category_name: string;
  merchant: string | null;
  source_snippet?: string | null;
  matched_entry_id: string | null;
  matched_entry: MatchedEntry | null;
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

type Props = {
  items: MergePreviewItem[];
  token: string | null;
  onReset: () => void;
  setResult: (r: { created: number; skipped: number; discarded?: number } | null) => void;
  resetButtonLabel?: string;
  sourceColumnLabel?: string;
};

export function MergeWizard({
  items,
  token,
  onReset,
  setResult,
  resetButtonLabel = 'Paste again',
  sourceColumnLabel = 'From SMS',
}: Props) {
  const [actionByIndex, setActionByIndex] = useState<Record<number, Action>>({});
  const [amountByIndex, setAmountByIndex] = useState<Record<number, string>>({});
  const [currencyByIndex, setCurrencyByIndex] = useState<Record<number, string>>({});
  const [dateByIndex, setDateByIndex] = useState<Record<number, string>>({});
  const [timeByIndex, setTimeByIndex] = useState<Record<number, string>>({});
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
  const [error, setError] = useState('');

  useEffect(() => {
    const initial: Record<number, Action> = {};
    items.forEach((it) => {
      initial[it.sheet_index] = it.matched_entry_id ? 'skip' : 'add_new';
    });
    setActionByIndex(initial);
  }, [items]);

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

  useEffect(() => {
    if (pickerForSheetIndex != null && token) loadPickerTransactions();
  }, [pickerForSheetIndex, token]);

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
    if (!token || !items.length) return;
    Promise.all([
      api<{ categories: Category[] }>('/v1/categories', { token }),
      api<{ tags: Tag[] }>('/v1/tags', { token }),
    ]).then(([cRes, tRes]) => {
      setCategories(cRes.categories ?? []);
      setTags(tRes.tags ?? []);
    });
  }, [token, items.length]);

  function getDisplayMatch(it: MergePreviewItem): MatchedEntry | null {
    const manual = manualMatchByIndex[it.sheet_index];
    if (manual) return manual;
    return it.matched_entry;
  }

  function getDefaultAction(it: MergePreviewItem): Action {
    if (manualMatchByIndex[it.sheet_index] || it.matched_entry_id) return 'skip';
    return 'add_new';
  }

  function getAmount(it: MergePreviewItem): number {
    const raw = amountByIndex[it.sheet_index];
    if (raw === undefined || raw === '') return it.amount;
    const n = parseFloat(String(raw).replace(/,/g, '.'));
    return Number.isFinite(n) ? n : it.amount;
  }

  function getCurrency(it: MergePreviewItem): string {
    const c = currencyByIndex[it.sheet_index];
    return (c !== undefined && c !== '' ? c.trim() : null) ?? it.currency;
  }

  function getDate(it: MergePreviewItem): string {
    const d = dateByIndex[it.sheet_index];
    return (d !== undefined && d !== '' ? d.trim() : null) ?? it.date;
  }

  function getTime(it: MergePreviewItem): string {
    const t = timeByIndex[it.sheet_index];
    if (t !== undefined && t !== '') return t.trim();
    return it.time ?? '';
  }

  function getMerchant(it: MergePreviewItem): string | null {
    const m = merchantByIndex[it.sheet_index];
    if (m === undefined) return it.merchant;
    const s = m.trim();
    return s === '' ? null : s;
  }

  function getCategoryName(it: MergePreviewItem): string {
    const id = categoryIdByIndex[it.sheet_index];
    const fromList = id ? categories.find((c) => c.id === id)?.name : null;
    return fromList ?? it.category_name;
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

  async function handleConfirm() {
    if (!items.length || !token) return;
    setError('');
    setConfirming(true);
    try {
      const payload = items.map((it) => {
        const action = actionByIndex[it.sheet_index] ?? getDefaultAction(it);
        const base = { sheet_index: it.sheet_index, action };
        const tagIds = tagIdsByIndex[it.sheet_index];
        if (action === 'discard') return base;
        if (action === 'add_new') {
          const categoryId = categoryIdByIndex[it.sheet_index];
          return {
            ...base,
            amount: getAmount(it),
            currency: getCurrency(it),
            date: getDate(it),
            time: getTime(it),
            merchant: getMerchant(it),
            category_name: getCategoryName(it),
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
      const res = await api<{ created: { id: string }[]; count: number; skipped: number; discarded?: number }>(
        '/v1/import/sms-merge-confirm',
        { method: 'POST', token, body: { items: payload } }
      );
      setResult({
        created: res.count ?? 0,
        skipped: res.skipped ?? 0,
        discarded: res.discarded ?? 0,
      });
      onReset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create transactions');
    } finally {
      setConfirming(false);
    }
  }

  const addNewCount = items.filter((it) => (actionByIndex[it.sheet_index] ?? getDefaultAction(it)) === 'add_new').length;

  return (
    <>
      <div className="sms-wizard-bar">
        <p className="sms-wizard-bar-text">
          {items.length} transaction(s) extracted. Change action per row, then confirm.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          {resetButtonLabel}
        </button>
      </div>

      {error && <p className="error sms-wizard-error">{error}</p>}

      <div className="sms-wizard-table-card">
        <div className="sms-wizard-table-wrap">
          <table className="sms-wizard-table">
            <thead>
              <tr>
                <th>{sourceColumnLabel}</th>
                <th>Matched existing</th>
                <th>Action</th>
                <th>Category</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const displayMatch = getDisplayMatch(it);
                const action = actionByIndex[it.sheet_index] ?? getDefaultAction(it);
                return (
                  <tr key={it.sheet_index}>
                    <td>
                      {it.source_snippet && (
                        <div className="sms-snippet" title="Source for this transaction">
                          {it.source_snippet}
                        </div>
                      )}
                      <div className="sms-edit-fields">
                        <label className="sms-edit-label">
                          Amount
                          <input
                            type="text"
                            inputMode="decimal"
                            className="input sms-edit-input"
                            value={amountByIndex[it.sheet_index] ?? ''}
                            onChange={(e) => setAmountByIndex((p) => ({ ...p, [it.sheet_index]: e.target.value }))}
                            placeholder={String(it.amount)}
                          />
                        </label>
                        <label className="sms-edit-label">
                          Currency
                          <input
                            type="text"
                            className="input sms-edit-input"
                            value={currencyByIndex[it.sheet_index] ?? ''}
                            onChange={(e) => setCurrencyByIndex((p) => ({ ...p, [it.sheet_index]: e.target.value }))}
                            placeholder={it.currency}
                          />
                        </label>
                        <label className="sms-edit-label">
                          Date
                          <input
                            type="text"
                            className="input sms-edit-input"
                            value={dateByIndex[it.sheet_index] ?? ''}
                            onChange={(e) => setDateByIndex((p) => ({ ...p, [it.sheet_index]: e.target.value }))}
                            placeholder={it.date}
                            title="YYYY-MM-DD"
                          />
                        </label>
                        <label className="sms-edit-label">
                          Time
                          <input
                            type="text"
                            className="input sms-edit-input"
                            value={timeByIndex[it.sheet_index] ?? ''}
                            onChange={(e) => setTimeByIndex((p) => ({ ...p, [it.sheet_index]: e.target.value }))}
                            placeholder={it.time ?? ''}
                          />
                        </label>
                        <label className="sms-edit-label">
                          Merchant
                          <input
                            type="text"
                            className="input sms-edit-input"
                            value={merchantByIndex[it.sheet_index] ?? it.merchant ?? ''}
                            onChange={(e) => setMerchant(it.sheet_index, e.target.value)}
                            placeholder="Merchant name"
                          />
                        </label>
                        <label className="sms-edit-label">
                          Category
                          {categories.length > 0 ? (
                            <select
                              className="input sms-edit-input"
                              value={categoryIdByIndex[it.sheet_index] ?? categories.find((c) => c.name === it.category_name)?.id ?? categories[0]?.id ?? ''}
                              onChange={(e) => setCategory(it.sheet_index, e.target.value)}
                            >
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="sms-row-meta">Loading…</span>
                          )}
                        </label>
                      </div>
                      <div className="sms-row-meta sms-edit-summary">
                        {getCurrency(it)} {getAmount(it).toFixed(2)} · {getDate(it)}
                        {getTime(it) ? ` ${getTime(it)}` : ''}
                        {getCategoryName(it) ? ` · ${getCategoryName(it)}` : ''}
                        {getMerchant(it) ? ` · ${getMerchant(it)}` : ''}
                      </div>
                    </td>
                    <td>
                      {displayMatch ? (
                        <div>
                          <div className="sms-row-amount">{displayMatch.amount.toFixed(2)} · {displayMatch.date}</div>
                          <div className="sms-row-meta">
                            {displayMatch.category_name}
                            {displayMatch.merchant ? ` · ${displayMatch.merchant}` : ''}
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginTop: '0.25rem' }}
                            onClick={() => setViewPopupEntry(displayMatch)}
                          >
                            View
                          </button>
                          {manualMatchByIndex[it.sheet_index] && (
                            <span className="sms-row-meta" style={{ marginLeft: '0.5rem' }}>(manual)</span>
                          )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          <span className="sms-row-meta">— No match</span>
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
                    <td>
                      <div className="sms-action-btns">
                        <button
                          type="button"
                          className={action === 'skip' ? 'btn btn-primary' : 'btn btn-secondary'}
                          onClick={() => setAction(it.sheet_index, 'skip')}
                        >
                          Confirm match
                        </button>
                        <button
                          type="button"
                          className={action === 'add_new' ? 'btn btn-primary' : 'btn btn-secondary'}
                          onClick={() => setAction(it.sheet_index, 'add_new')}
                        >
                          Add as new
                        </button>
                        <button
                          type="button"
                          className={action === 'discard' ? 'btn btn-primary' : 'btn btn-secondary'}
                          onClick={() => setAction(it.sheet_index, 'discard')}
                        >
                          Discard
                        </button>
                      </div>
                      <div className="sms-action-hint">
                        {action === 'discard'
                          ? '✓ Row will be ignored'
                          : action === 'skip'
                            ? '✓ Will not create (matched to existing)'
                            : '✓ Will create as new transaction'}
                      </div>
                    </td>
                    <td>
                      {action === 'add_new' && categories.length > 0 ? (
                        <select
                          className="input"
                          style={{ fontSize: '0.85rem', padding: '0.35rem 0.5rem', minWidth: 120, marginBottom: 0 }}
                          value={categoryIdByIndex[it.sheet_index] ?? categories.find((c) => c.name === getCategoryName(it))?.id ?? categories[0]?.id ?? ''}
                          onChange={(e) => setCategory(it.sheet_index, e.target.value)}
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="sms-row-meta">—</span>
                      )}
                    </td>
                    <td>
                      {tags.length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {tags.map((tag) => {
                            const selected = (tagIdsByIndex[it.sheet_index] ?? []).includes(tag.id);
                            return (
                              <label key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={selected} onChange={() => toggleTag(it.sheet_index, tag.id)} />
                                <span>{tag.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="sms-row-meta">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sms-wizard-footer">
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
        {addNewCount === 0 && items.length > 0 && (
          <span className="sms-wizard-footer-hint">
            All rows are “Confirm match”. Click the button above to finish, or switch any row to “Add as new” to create it.
          </span>
        )}
      </div>

      {viewPopupEntry != null && (
        <div className="sms-modal-backdrop" style={{ zIndex: 1001 }} onClick={() => setViewPopupEntry(null)}>
          <div className="sms-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sms-modal-header">
              <h3>Transaction</h3>
              <button type="button" className="btn btn-primary" onClick={() => setViewPopupEntry(null)}>Close</button>
            </div>
            <div className="sms-modal-body">
              <dl className="sms-dl">
                <dt>Amount</dt><dd>{viewPopupEntry.amount.toFixed(2)}</dd>
                <dt>Date</dt><dd>{viewPopupEntry.date}</dd>
                <dt>Category</dt><dd>{viewPopupEntry.category_name || '—'}</dd>
                <dt>Merchant</dt><dd>{viewPopupEntry.merchant || '—'}</dd>
              </dl>
            </div>
          </div>
        </div>
      )}

      {pickerForSheetIndex != null && (
        <div className="sms-modal-backdrop" onClick={() => setPickerForSheetIndex(null)}>
          <div className="sms-modal sms-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="sms-modal-header">
              <h3>Match to a transaction</h3>
            </div>
            <div className="sms-modal-body">
              <p className="sms-modal-intro">
                Choose the existing transaction that matches this row. The row will be treated as a duplicate and not added.
              </p>
              {pickerLoading ? (
                <p className="sms-row-meta">Loading transactions…</p>
              ) : pickerTransactions.length === 0 ? (
                <p className="sms-row-meta">No transactions found.</p>
              ) : (
                <ul className="sms-picker-list">
                  {pickerTransactions.map((tx) => (
                    <li
                      key={tx.id}
                      className="sms-picker-item"
                      onClick={() => selectManualMatch(tx)}
                      onKeyDown={(e) => e.key === 'Enter' && selectManualMatch(tx)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="sms-row-amount">
                        {tx.currency} {tx.amount.toFixed(2)} · {tx.date}
                      </div>
                      <div className="sms-picker-meta">
                        {tx.category?.name ?? '—'}
                        {tx.merchant ? ` · ${tx.merchant}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sms-modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setPickerForSheetIndex(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="sms-page-links">
        <Link to="/transactions">← Transactions</Link> · <Link to="/add">Add transaction</Link>
      </p>
    </>
  );
}
