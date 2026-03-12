import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken, setStoredIngestToken } from '../App';

const BASE = import.meta.env.VITE_API_URL || '';

export default function Settings() {
  const token = getStoredToken();
  const [ingestMessage, setIngestMessage] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  async function generateIngestToken() {
    if (!token) return;
    setIngestMessage('');
    try {
      const res = await api<{ ingest_token: string }>('/v1/users/me/ingest-token', {
        method: 'POST',
        body: {},
        token,
      });
      if (res.ingest_token) {
        setStoredIngestToken(res.ingest_token);
        setIngestMessage('Ingest token saved. Use it for SMS ingest or Shortcuts.');
      }
    } catch (e) {
      setIngestMessage(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function handleExport() {
    if (!token) return;
    setExportMessage('');
    try {
      const res = await fetch(`${BASE}/v1/users/export`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || res.statusText);
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mezan-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMessage('Export downloaded.');
    } catch (e) {
      setExportMessage(e instanceof Error ? e.message : 'Export failed');
    }
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    setImportMessage('');
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      if (!data || typeof data !== 'object' || !('version' in data) && !('user' in data) && !('transactions' in data)) {
        setImportMessage('Invalid export file.');
        return;
      }
      if (!window.confirm('This will replace all your categories, tags, budgets, and transactions with the imported data. Continue?')) {
        return;
      }
      const res = await api<{ ok: boolean; imported?: { categories: number; tags: number; budgets: number; transactions: number } }>(
        '/v1/import/data',
        { method: 'POST', body: data, token }
      );
      if (res.ok && res.imported) {
        setImportMessage(`Imported: ${res.imported.categories} categories, ${res.imported.tags} tags, ${res.imported.budgets} budgets, ${res.imported.transactions} transactions.`);
      } else {
        setImportMessage('Import completed.');
      }
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-subtitle">Account and ingest</p>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0' }}>Setup wizard</h2>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#666' }}>
          Run the setup wizard again to add categories, train the AI with your messages, or set budgets.
        </p>
        <Link to="/setup" className="btn btn-secondary">Open setup wizard</Link>
      </div>
      <div className="card">
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem 0' }}>Ingest token</h2>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#666' }}>
          Used for Add from SMS and for Shortcuts/automation. Generate and store it; the web app will use it when you paste SMS.
        </p>
        <button type="button" className="btn btn-primary" onClick={generateIngestToken}>
          Generate ingest token
        </button>
        {ingestMessage && (
          <p className={ingestMessage.startsWith('Ingest') ? 'success' : 'error'} style={{ marginTop: '0.75rem' }}>
            {ingestMessage}
          </p>
        )}
      </div>
      <div className="card" style={{ marginTop: '1rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0' }}>Export / Import data</h2>
        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#666' }}>
          Export all your data (categories, tags, budgets, transactions, settings) as a JSON file. Import replaces your current data with the file contents.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Export data
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleImportClick}>
            Import data
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>
        {exportMessage && (
          <p className={exportMessage.startsWith('Export') && !exportMessage.includes('failed') ? 'success' : 'error'} style={{ marginTop: '0.75rem' }}>
            {exportMessage}
          </p>
        )}
        {importMessage && (
          <p className={importMessage.includes('Imported') || importMessage === 'Import completed.' ? 'success' : 'error'} style={{ marginTop: '0.75rem' }}>
            {importMessage}
          </p>
        )}
      </div>
    </>
  );
}
