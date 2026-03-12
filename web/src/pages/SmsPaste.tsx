import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';
import { MergeWizard, type MergePreviewItem } from '../components/MergeWizard';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function SmsPaste() {
  const token = getStoredToken();
  const [text, setText] = useState('');
  const [expectedMonths, setExpectedMonths] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewItems, setPreviewItems] = useState<MergePreviewItem[] | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; discarded?: number } | null>(null);

  function toggleExpectedMonth(m: number) {
    setExpectedMonths((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)
    );
  }

  async function handleParseAndMatch() {
    if (!token) {
      setError('Please log in to use the match wizard.');
      return;
    }
    const raw = text.trim();
    if (!raw) {
      setError('Paste SMS text first.');
      return;
    }
    setError('');
    setPreviewItems(null);
    setResult(null);
    setLoading(true);
    try {
      const body: { raw_text: string; expected_months?: number[] } = { raw_text: raw };
      if (expectedMonths.length > 0) body.expected_months = expectedMonths;
      const res = await api<{ items: MergePreviewItem[] }>('/v1/import/sms-merge-preview', {
        method: 'POST',
        token,
        body,
      });
      const items = res.items ?? [];
      setPreviewItems(items);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to parse or match SMS';
      setError(msg);
      if (msg.includes('501') || msg.includes('not configured')) {
        setError('AI extraction is not configured. Set OPENAI_API_KEY in the backend .env and restart the server.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleWizardReset() {
    setPreviewItems(null);
    setResult(null);
  }

  return (
    <div className="sms-page">
      <header className="sms-header">
        <h1 className="page-title">Add from SMS</h1>
        <p className="page-subtitle">
          Paste an SMS message. We’ll extract transactions, match them to existing ones, and let you confirm or add as new.
        </p>
      </header>

      {result != null && (
        <div className="sms-result-card">
          <p className="sms-result-summary">
            <strong>Done.</strong>{' '}
            {result.created === 0 && result.skipped === 0 && (result.discarded ?? 0) === 0
              ? 'No changes.'
              : [
                  result.created > 0 && `${result.created} added`,
                  result.skipped > 0 && `${result.skipped} matched`,
                  (result.discarded ?? 0) > 0 && `${result.discarded} discarded`,
                ].filter(Boolean).join(', ') + '.'}
          </p>
          <p className="sms-result-links">
            <Link to="/transactions" state={{ showAll: true }}>View all transactions</Link>
            {' · '}
            <Link to="/">Home</Link>
          </p>
        </div>
      )}

      {!previewItems ? (
        <div className="sms-paste-card">
          <div className="expected-months-block">
            <span className="label">Expected month(s) for these transactions</span>
            <p className="expected-months-hint">
              If dates are ambiguous (e.g. 03/11 vs 11/03), we’ll treat the number that matches a selected month as the month.
            </p>
            <div className="expected-months-chips">
              {MONTH_NAMES.map((name, i) => {
                const month = i + 1;
                const checked = expectedMonths.includes(month);
                return (
                  <label key={month} className="expected-month-chip">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleExpectedMonth(month)}
                    />
                    <span>{name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <label className="label" htmlFor="sms-text">
            Paste SMS text
          </label>
          <textarea
            id="sms-text"
            className="input"
            placeholder="Paste one or more transaction SMS messages. The content is sent to the server to extract and match."
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            rows={10}
          />
          {error && <p className="error">{error}</p>}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleParseAndMatch}
            disabled={loading}
          >
            {loading ? 'Parsing & matching…' : 'Parse & match'}
          </button>
        </div>
      ) : (
        <MergeWizard
          items={previewItems}
          token={token}
          onReset={handleWizardReset}
          setResult={setResult}
          resetButtonLabel="Paste again"
          sourceColumnLabel="From SMS"
        />
      )}

      <p className="sms-page-links">
        <Link to="/transactions">← Transactions</Link> · <Link to="/add">Add transaction</Link>
      </p>
    </div>
  );
}
