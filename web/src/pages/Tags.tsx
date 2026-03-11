import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { getStoredToken } from '../App';

type Tag = { id: string; name: string };

export default function Tags() {
  const token = getStoredToken();
  const [list, setList] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Tag | null>(null);
  const [editName, setEditName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api<{ tags: Tag[] }>('/v1/tags', { token })
      .then((r) => {
        setList(r.tags || []);
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
      await api('/v1/tags', {
        method: 'POST',
        token: token!,
        body: { name: trimmed },
      });
      setName('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(t: Tag) {
    setEditing(t);
    setEditName(t.name);
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
      await api(`/v1/tags/${editing.id}`, {
        method: 'PATCH',
        token: token!,
        body: { name: trimmed },
      });
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t: Tag) {
    if (!window.confirm(`Delete tag "${t.name}"? It will be removed from transactions.`)) return;
    setDeletingId(t.id);
    setError('');
    try {
      await api(`/v1/tags/${t.id}`, { method: 'DELETE', token: token! });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <>
      <h1 className="page-title">Tags</h1>
      <p className="page-subtitle">Your tags</p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Add tag</h2>
        <form onSubmit={handleAdd}>
          <label className="label">Name</label>
          <input
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Work"
            required
          />
          {error && !editing && <p className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ marginTop: '0.75rem' }} disabled={saving}>
            {saving ? 'Adding…' : 'Add tag'}
          </button>
        </form>
      </div>

      {editing && (
        <div className="card" style={{ marginBottom: '1rem', border: '2px solid #0d7377' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Edit tag</h2>
          <form onSubmit={handleEditSave}>
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
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
        <div className="card"><p style={{ margin: 0, color: '#666' }}>No tags yet. Add one above.</p></div>
      ) : (
        <ul className="list">
          {list.map((t) => (
            <li key={t.id} className="list-item">
              <span className="list-item-main"><strong>{t.name}</strong></span>
              <span style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem' }}
                  onClick={() => startEdit(t)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.85rem', color: '#c62828' }}
                  onClick={() => handleDelete(t)}
                  disabled={deletingId === t.id}
                >
                  {deletingId === t.id ? '…' : 'Delete'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
