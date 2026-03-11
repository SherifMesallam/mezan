import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken, setStoredIngestToken } from '../App';

export default function Settings() {
  const token = getStoredToken();
  const [ingestMessage, setIngestMessage] = useState('');

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
    </>
  );
}
