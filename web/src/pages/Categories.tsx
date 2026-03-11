import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { getStoredToken } from '../App';

type Category = { id: string; name: string; parent_id?: string | null; is_system?: boolean; transaction_count?: number };

export default function Categories() {
  const token = getStoredToken();
  const [list, setList] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editParentId, setEditParentId] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api<{ categories: Category[] }>('/v1/categories', { token })
      .then((r) => {
        setList(r.categories || []);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api('/v1/categories', {
        method: 'POST',
        token: token!,
        body: { name: trimmed, parent_id: parentId || null },
      });
      setName('');
      setParentId('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: Category) {
    setEditing(c);
    setEditName(c.name);
    setEditParentId(c.parent_id || '');
    setError('');
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api(`/v1/categories/${editing.id}`, {
        method: 'PATCH',
        token: token!,
        body: { name: trimmed, parent_id: editParentId || null },
      });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: Category) {
    const count = c.transaction_count ?? 0;
    const message =
      count > 0
        ? `This category has ${count} transaction(s). Deleting it will permanently delete those transactions.\n\nDelete category "${c.name}"?`
        : `Delete category "${c.name}"?`;
    if (!window.confirm(message)) return;
    setDeletingId(c.id);
    setError('');
    try {
      await api(`/v1/categories/${c.id}`, { method: 'DELETE', token: token! });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  }

  const topLevel = list.filter((c) => !c.parent_id);
  const topLevelForEdit = list.filter((c) => !c.parent_id && c.id !== editing?.id);

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <>
      <h1 className="page-title">Categories</h1>
      <p className="page-subtitle">Your expense categories</p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Add category</h2>
        <form onSubmit={handleAdd}>
          <label className="label">Name</label>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Food"
            required
          />
          {topLevel.length > 0 && (
            <>
              <label className="label">Parent (optional)</label>
              <select
                className="input"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">— None (top-level) —</option>
                {topLevel.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </>
          )}
          {error && !editing && <p className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={saving}>
            {saving ? 'Adding…' : 'Add category'}
          </button>
        </form>
      </div>

      {editing && (
        <div className="card" style={{ marginBottom: '1rem', border: '2px solid #0d7377' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Edit category</h2>
          <form onSubmit={handleEditSave}>
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
            {topLevelForEdit.length > 0 && (
              <>
                <label className="label">Parent (optional)</label>
                <select
                  className="input"
                  value={editParentId}
                  onChange={(e) => setEditParentId(e.target.value)}
                >
                  <option value="">— None (top-level) —</option>
                  {topLevelForEdit.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </>
            )}
            {error && <p className="error">{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setEditing(null); setError(''); }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {list.length === 0 ? (
        <div className="card"><p style={{ margin: 0, color: '#666' }}>No categories yet. Add one above.</p></div>
      ) : (
        <ul className="list">
          {list.map((c) => (
            <li key={c.id} className="list-item">
              <span className="list-item-main">
                <strong>{c.name}</strong>
                {c.parent_id && <span style={{ fontSize: '0.85rem', color: '#888' }}> Sub-category</span>}
              </span>
              <span style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                  onClick={() => startEdit(c)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', color: '#c62828' }}
                  onClick={() => handleDelete(c)}
                  disabled={deletingId === c.id}
                >
                  {deletingId === c.id ? '…' : 'Delete'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
