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
      await api('/v1/transactions', {
        method: 'POST',
        token: token!,
        body: {
          amount: amt,
          currency: 'EGP',
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
    <>
      <h1 className="page-title">Add transaction</h1>
      <p className="page-subtitle">Manual entry</p>
      <form onSubmit={submit} className="card">
        <label className="label">Amount (EGP)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <label className="label">Merchant (optional)</label>
        <input
          type="text"
          className="input"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder="e.g. Fawry"
        />
        <label className="label">Category</label>
        <select
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <label className="label">Date</label>
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        <label className="label">Time</label>
        <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
        {tags.length > 0 && (
          <>
            <label className="label">Tags</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
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
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem' }} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </>
  );
}
