import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';
import { MergeWizard, type MergePreviewItem } from '../components/MergeWizard';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function readFileAsBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        reject(new Error('Failed to read file as base64'));
        return;
      }
      resolve({ base64: match[2], mimeType: match[1] });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function AddFromImage() {
  const token = getStoredToken();
  const [expectedMonths, setExpectedMonths] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewItems, setPreviewItems] = useState<MergePreviewItem[] | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; discarded?: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleExpectedMonth(m: number) {
    setExpectedMonths((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)
    );
  }

  async function handleFileSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!file || !token) {
      setError(token ? 'Choose an image first.' : 'Please log in.');
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setError('Please choose a JPEG, PNG, WebP or GIF image.');
      return;
    }
    setError('');
    setPreviewItems(null);
    setResult(null);
    setLoading(true);
    try {
      const { base64, mimeType } = await readFileAsBase64(file);
      const body: { image_base64: string; mime_type: string; expected_months?: number[] } = {
        image_base64: base64,
        mime_type: mimeType,
      };
      if (expectedMonths.length > 0) body.expected_months = expectedMonths;
      const res = await api<{ items: MergePreviewItem[] }>('/v1/import/image-merge-preview', {
        method: 'POST',
        token,
        body,
      });
      const items = res.items ?? [];
      setPreviewItems(items);
      if (input) input.value = '';
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to extract transactions from image';
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
        <h1 className="page-title">Add from image</h1>
        <p className="page-subtitle">
          Upload a receipt or bill. We’ll OCR it, extract transactions, match them to existing ones, and let you confirm or add as new.
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
          <form onSubmit={handleFileSubmit}>
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
            <label className="label" htmlFor="image-file">
              Choose an image (receipt, bill, screenshot)
            </label>
            <input
              ref={fileInputRef}
              id="image-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="input"
              onChange={() => setError('')}
            />
            {error && <p className="error">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Extracting…' : 'Extract transactions'}
            </button>
          </form>
        </div>
      ) : (
        <MergeWizard
          items={previewItems}
          token={token}
          onReset={handleWizardReset}
          setResult={setResult}
          resetButtonLabel="Upload another image"
          sourceColumnLabel="From image"
        />
      )}

      <p className="sms-page-links">
        <Link to="/transactions">← Transactions</Link> · <Link to="/add">Add transaction</Link>
      </p>
    </div>
  );
}
