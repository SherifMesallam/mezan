import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';

type Category = { id: string; name: string };
type Tag = { id: string; name: string };

export default function AddTransaction() {
  const navigate = useNavigate();
  const token = getStoredToken();
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [egpValue, setEgpValue] = useState('');
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => {
    const t = new Date();
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api<{ categories: Category[] }>('/v1/categories', { token }),
      api<{ tags: Tag[] }>('/v1/tags', { token }),
    ])
      .then(([c, t]) => {
        setCategories(c.categories || []);
        setTags(t.tags || []);
        if (c.categories?.length && !categoryId) setCategoryId(c.categories[0].id);
      })
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.trim());
    if (Number.isNaN(amt) || amt <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (!categoryId) {
      setError('Select a category');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const egpNum = egpValue.trim() ? parseFloat(egpValue.trim()) : null;
      await api('/v1/transactions', {
        method: 'POST',
        token: token!,
        body: {
          amount: amt,
          currency: currency || 'EGP',
          egp_value: egpNum != null && !Number.isNaN(egpNum) ? egpNum : undefined,
          category_id: categoryId,
          date,
          time,
          tag_ids: tagIds,
          merchant: merchant.trim() || null,
          source: 'manual',
        },
      });
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="add-page">
      <header className="add-header">
        <h1 className="page-title">Add transaction</h1>
        <p className="page-subtitle">Enter a transaction manually</p>
      </header>

      <form onSubmit={submit} className="add-form-card">
        <section className="add-form-section">
          <h2 className="add-form-section-title">Amount & currency</h2>
          <label className="label" htmlFor="add-amount">Amount</label>
          <input
            id="add-amount"
            type="number"
            step="0.01"
            min="0"
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
          <label className="label" htmlFor="add-currency">Currency</label>
          <select
            id="add-currency"
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
              <label className="label" htmlFor="add-egp">EGP value (optional)</label>
              <p className="add-form-hint">
                Used in totals, budgets and charts. Enter the equivalent in EGP so this transaction is counted correctly.
              </p>
              <input
                id="add-egp"
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
        </section>

        <section className="add-form-section">
          <h2 className="add-form-section-title">Details</h2>
          <label className="label" htmlFor="add-merchant">Merchant (optional)</label>
          <input
            id="add-merchant"
            type="text"
            className="input"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="e.g. Fawry, APPLE.COM"
          />
          <label className="label" htmlFor="add-category">Category</label>
          <select
            id="add-category"
            className="input"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {tags.length > 0 && (
            <>
              <label className="label">Tags</label>
              <div className="add-form-tags">
                {tags.map((t) => (
                  <label
                    key={t.id}
                    className={`add-form-tag ${tagIds.includes(t.id) ? 'add-form-tag--checked' : ''}`}
                  >
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
        </section>

        <section className="add-form-section">
          <h2 className="add-form-section-title">Date & time</h2>
          <div className="add-form-row">
            <div>
              <label className="label" htmlFor="add-date">Date</label>
              <input
                id="add-date"
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="add-time">Time</label>
              <input
                id="add-time"
                type="time"
                className="input"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
        </section>

        <div className="add-form-footer">
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save transaction'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/')}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
