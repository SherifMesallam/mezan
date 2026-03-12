import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';

type ExtractedItem = {
  amount: number;
  currency: string;
  date: string;
  time: string;
  merchant: string | null;
  suggested_category: string | null;
};

type Category = { id: string; name: string };
type Tag = { id: string; name: string };

const STEPS = [
  { id: 1, title: 'Categories & tags' },
  { id: 2, title: 'Paste messages & review' },
  { id: 3, title: 'Budgets (optional)' },
];

const SETUP_STEP_KEY = 'mezan_setup_step';

function getStoredSetupStep(): number {
  const s = sessionStorage.getItem(SETUP_STEP_KEY);
  const n = parseInt(s ?? '', 10);
  return n >= 1 && n <= 3 ? n : 1;
}

function setStoredSetupStep(step: number) {
  sessionStorage.setItem(SETUP_STEP_KEY, String(step));
}

export default function SetupWizard() {
  const token = getStoredToken();
  const navigate = useNavigate();
  const [step, setStep] = useState(getStoredSetupStep);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [exampleCategories, setExampleCategories] = useState<string[]>([]);
  const [exampleTags, setExampleTags] = useState<string[]>([]);
  const [selectedExampleCategories, setSelectedExampleCategories] = useState<Set<string>>(new Set());
  const [selectedExampleTags, setSelectedExampleTags] = useState<Set<string>>(new Set());
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [customTagInput, setCustomTagInput] = useState('');
  const [userCategories, setUserCategories] = useState<Category[]>([]);
  const [userTags, setUserTags] = useState<Tag[]>([]);

  // Step 2: one row per unique merchant; confirm removes row
  const [pasteText, setPasteText] = useState('');
  const [extracted, setExtracted] = useState<ExtractedItem[]>([]);
  const [extractAttempted, setExtractAttempted] = useState(false);
  const [reviewChoicesByMerchant, setReviewChoicesByMerchant] = useState<
    Record<string, { category_id: string; tag_ids: string[] }>
  >({});
  const [confirmedMerchants, setConfirmedMerchants] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    api<{ categories: string[]; tags: string[] }>('/v1/setup/examples', { token })
      .then((r) => {
        setExampleCategories(r.categories || []);
        setExampleTags(r.tags || []);
      })
      .catch(() => {});
  }, [token]);

  const loadUserCategoriesAndTags = async () => {
    if (!token) return;
    const [catRes, tagRes] = await Promise.all([
      api<{ categories: Category[] }>('/v1/categories', { token }),
      api<{ tags: Tag[] }>('/v1/tags', { token }),
    ]);
    setUserCategories(catRes.categories || []);
    setUserTags(tagRes.tags || []);
  };

  // Load existing categories/tags on mount so step 1 shows saved data and we can advance if they already have some
  useEffect(() => {
    if (token) loadUserCategoriesAndTags();
  }, [token]);

  // Persist step when it changes so reload keeps progress
  useEffect(() => {
    setStoredSetupStep(step);
  }, [step]);

  async function handleStep1Next() {
    setError('');
    setLoading(true);
    try {
      const existingCategoryNames = new Set(userCategories.map((c) => c.name.toLowerCase().trim()));
      const existingTagNames = new Set(userTags.map((t) => t.name.toLowerCase().trim()));

      const wantedCategories = [
        ...selectedExampleCategories,
        ...customCategories.filter((n) => n.trim()),
      ].filter(Boolean);
      const wantedTags = [
        ...selectedExampleTags,
        ...customTags.filter((n) => n.trim()),
      ].filter(Boolean);

      const toCreateCategories = wantedCategories.filter(
        (name) => !existingCategoryNames.has(name.trim().toLowerCase())
      );
      const toCreateTags = wantedTags.filter(
        (name) => !existingTagNames.has(name.trim().toLowerCase())
      );

      for (const name of toCreateCategories) {
        await api('/v1/categories', { method: 'POST', token: token!, body: { name: name.trim() } });
      }
      for (const name of toCreateTags) {
        await api('/v1/tags', { method: 'POST', token: token!, body: { name: name.trim() } });
      }

      const willHaveCategories = userCategories.length + toCreateCategories.length > 0;
      if (!willHaveCategories) {
        setError('Add at least one category.');
        setLoading(false);
        return;
      }
      await loadUserCategoriesAndTags();
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleExtract() {
    if (!pasteText.trim()) {
      setError('Paste some messages first.');
      return;
    }
    setError('');
    setLoading(true);
    const controller = new AbortController();
    const timeoutMs = 5 * 60 * 1000; // 5 minutes for large pastes (multiple chunks)
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await api<{ transactions: ExtractedItem[] }>('/v1/setup/preview-extract', {
        method: 'POST',
        token: token!,
        body: { raw_text: pasteText },
        signal: controller.signal,
      });
      setExtractAttempted(true);
      setExtracted(res.transactions || []);
      setReviewChoicesByMerchant({});
      setConfirmedMerchants(new Set());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Extraction failed';
      setError(
        msg.includes('abort') ? 'Extraction timed out. Try with fewer messages or try again.' : msg
      );
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  const hasExtractedButEmpty = extractAttempted && !loading && extracted.length === 0;

  const merchantKey = (m: string | null) => (m?.trim() || '(Unknown)');

  /** Find user category id whose name matches the suggested category (e.g. AI "Groceries" → your "Groceries"). */
  function findCategoryIdBySuggestedName(suggested: string | null): string {
    if (!suggested?.trim() || userCategories.length === 0) return userCategories[0]?.id ?? '';
    const lower = suggested.trim().toLowerCase();
    const found = userCategories.find((c) => c.name.trim().toLowerCase() === lower);
    if (found) return found.id;
    return userCategories[0]?.id ?? '';
  }

  /** Effective category id for this merchant: explicit choice, or auto-selected from suggested, or first category. */
  function getCategoryIdForMerchant(merchant: string, suggestedCategory: string | null): string {
    return (
      reviewChoicesByMerchant[merchant]?.category_id ??
      findCategoryIdBySuggestedName(suggestedCategory) ??
      userCategories[0]?.id ??
      ''
    );
  }

  function setReviewChoiceForMerchant(
    merchant: string,
    category_id: string,
    tag_ids: string[] = reviewChoicesByMerchant[merchant]?.tag_ids ?? []
  ) {
    setReviewChoicesByMerchant((prev) => ({ ...prev, [merchant]: { category_id, tag_ids } }));
  }

  function toggleReviewTagForMerchant(merchant: string, suggestedCategory: string | null, tagId: string) {
    const current = reviewChoicesByMerchant[merchant]?.tag_ids ?? [];
    const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
    const category_id = getCategoryIdForMerchant(merchant, suggestedCategory);
    setReviewChoicesByMerchant((prev) => ({
      ...prev,
      [merchant]: { category_id, tag_ids: next },
    }));
  }

  function confirmMerchant(merchant: string, suggestedCategory: string | null) {
    const category_id = getCategoryIdForMerchant(merchant, suggestedCategory);
    const tag_ids = reviewChoicesByMerchant[merchant]?.tag_ids ?? [];
    setReviewChoicesByMerchant((prev) => ({ ...prev, [merchant]: { category_id, tag_ids } }));
    setConfirmedMerchants((prev) => new Set([...prev, merchant]));
  }

  // Group extracted by merchant (one row per vendor in the list)
  const merchantRows = (() => {
    const byMerchant = new Map<string, { suggestedCategory: string | null; count: number }>();
    extracted.forEach((tx) => {
      const k = merchantKey(tx.merchant);
      const cur = byMerchant.get(k);
      if (!cur) byMerchant.set(k, { suggestedCategory: tx.suggested_category, count: 1 });
      else cur.count += 1;
    });
    return [...byMerchant.entries()]
      .filter(([m]) => !confirmedMerchants.has(m))
      .map(([merchant, { suggestedCategory, count }]) => ({ merchant, suggestedCategory, count }));
  })();

  async function handleConfirmExtracted() {
    if (userCategories.length === 0) {
      setError('No categories. Go back to step 1 and add at least one.');
      return;
    }
    const defaultCategoryId = userCategories[0]?.id ?? '';
    const items = extracted.map((tx) => {
      const merchant = merchantKey(tx.merchant);
      const choice = reviewChoicesByMerchant[merchant];
      const category_id = choice?.category_id || defaultCategoryId;
      return {
        amount: tx.amount,
        currency: tx.currency,
        date: tx.date,
        time: tx.time || '00:00',
        merchant: tx.merchant,
        category_id,
        tag_ids: choice?.tag_ids ?? [],
      };
    });
    setError('');
    setLoading(true);
    try {
      await api('/v1/setup/confirm-extracted', {
        method: 'POST',
        token: token!,
        body: { items },
      });
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create transactions');
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    setError('');
    setLoading(true);
    try {
      await api('/v1/setup/complete', { method: 'POST', token: token! });
      sessionStorage.removeItem(SETUP_STEP_KEY);
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  function triggerImportFile() {
    importFileInputRef.current?.click();
  }

  async function handleSetupImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = '';
    setError('');
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      if (!data || typeof data !== 'object' || (!('version' in data) && !('user' in data) && !('transactions' in data))) {
        setError('Invalid export file.');
        return;
      }
      await api<{ ok?: boolean }>('/v1/import/data', { method: 'POST', body: data, token: token! });
      await api('/v1/setup/complete', { method: 'POST', token: token! });
      sessionStorage.removeItem(SETUP_STEP_KEY);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function toggleExampleCategory(name: string) {
    setSelectedExampleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleExampleTag(name: string) {
    setSelectedExampleTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <>
      <h1 className="page-title">Setup wizard</h1>
      <p className="page-subtitle">Get started in a few steps</p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {STEPS.map((s) => (
          <span
            key={s.id}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 6,
              background: step === s.id ? '#2196F3' : '#eee',
              color: step === s.id ? '#fff' : '#666',
              fontWeight: step === s.id ? 600 : 400,
            }}
          >
            {s.id}. {s.title}
          </span>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {/* Step 1: Categories & tags */}
      {step === 1 && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0' }}>Import from backup (optional)</h2>
          <p style={{ margin: '0 0 1rem 0', color: '#666', fontSize: '0.95rem' }}>
            If you have a Mezan export file, import it to restore your categories, tags, budgets, and transactions. This will replace any existing data, then finish setup.
          </p>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleSetupImportFile}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={triggerImportFile}
            disabled={importing}
            style={{ marginBottom: '1.5rem' }}
          >
            {importing ? 'Importing…' : 'Choose file to import'}
          </button>
          <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0 0 1.5rem 0' }} />
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0' }}>Or create categories (required)</h2>
          {userCategories.length > 0 && (
            <p style={{ margin: '0 0 1rem 0', padding: '0.5rem 0.75rem', background: '#E8F5E9', borderRadius: 6, fontSize: '0.9rem' }}>
              Saved: you have {userCategories.length} categor{userCategories.length === 1 ? 'y' : 'ies'}
              {userTags.length > 0 ? ` and ${userTags.length} tag${userTags.length === 1 ? '' : 's'}` : ''}. Add more below or click Next to continue.
            </p>
          )}
          <p style={{ margin: '0 0 1rem 0', color: '#666', fontSize: '0.95rem' }}>
            Select example categories or add your own. You need at least one.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            {exampleCategories.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => toggleExampleCategory(name)}
                style={{
                  padding: '0.4rem 0.75rem',
                  borderRadius: 6,
                  border: selectedExampleCategories.has(name) ? '2px solid #2196F3' : '1px solid #ccc',
                  background: selectedExampleCategories.has(name) ? '#E3F2FD' : '#fff',
                  cursor: 'pointer',
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#666' }}>Or add your own (you can add many):</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {customCategories.map((name, idx) => (
              <span
                key={`${name}-${idx}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.35rem 0.6rem',
                  borderRadius: 6,
                  background: '#E3F2FD',
                  border: '1px solid #2196F3',
                  fontSize: '0.9rem',
                }}
              >
                {name}
                <button
                  type="button"
                  onClick={() => setCustomCategories((prev) => prev.filter((_, i) => i !== idx))}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    fontSize: '1.1rem',
                    color: '#666',
                  }}
                  aria-label="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            <input
              type="text"
              className="input"
              placeholder="Type a category and press Enter to add"
              value={customCategoryInput}
              onChange={(e) => setCustomCategoryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = customCategoryInput.trim();
                  if (v && !customCategories.includes(v)) {
                    setCustomCategories((prev) => [...prev, v]);
                    setCustomCategoryInput('');
                  }
                }
              }}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const v = customCategoryInput.trim();
                if (v && !customCategories.includes(v)) {
                  setCustomCategories((prev) => [...prev, v]);
                  setCustomCategoryInput('');
                }
              }}
            >
              Add
            </button>
          </div>

          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0' }}>Create tags (optional)</h2>
          <p style={{ margin: '0 0 1rem 0', color: '#666', fontSize: '0.95rem' }}>
            Tags help you filter transactions later.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            {exampleTags.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => toggleExampleTag(name)}
                style={{
                  padding: '0.4rem 0.75rem',
                  borderRadius: 6,
                  border: selectedExampleTags.has(name) ? '2px solid #7B1FA2' : '1px solid #ccc',
                  background: selectedExampleTags.has(name) ? '#F3E5F5' : '#fff',
                  cursor: 'pointer',
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#666' }}>Or add your own (you can add many):</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {customTags.map((name, idx) => (
              <span
                key={`${name}-${idx}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.35rem 0.6rem',
                  borderRadius: 6,
                  background: '#F3E5F5',
                  border: '1px solid #7B1FA2',
                  fontSize: '0.9rem',
                }}
              >
                {name}
                <button
                  type="button"
                  onClick={() => setCustomTags((prev) => prev.filter((_, i) => i !== idx))}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    fontSize: '1.1rem',
                    color: '#666',
                  }}
                  aria-label="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="text"
              className="input"
              placeholder="Type a tag and press Enter to add"
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = customTagInput.trim();
                  if (v && !customTags.includes(v)) {
                    setCustomTags((prev) => [...prev, v]);
                    setCustomTagInput('');
                  }
                }
              }}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const v = customTagInput.trim();
                if (v && !customTags.includes(v)) {
                  setCustomTags((prev) => [...prev, v]);
                  setCustomTagInput('');
                }
              }}
            >
              Add
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={handleStep1Next} disabled={loading}>
            {loading ? 'Creating…' : 'Next: Paste messages'}
          </button>
        </div>
      )}

      {/* Step 2: Paste & review */}
      {step === 2 && (
        <div className="card" style={{ maxWidth: 720 }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0' }}>Paste your message dump</h2>
          <p style={{ margin: '0 0 1rem 0', color: '#666', fontSize: '0.95rem' }}>
            The more messages you paste, the better the AI can learn. We'll extract transactions and suggest categories; you confirm or correct each one.
          </p>
          <textarea
            className="input"
            placeholder="Paste SMS or bank messages here (one or many)..."
            value={pasteText}
            onChange={(e) => { setPasteText(e.target.value); setExtractAttempted(false); }}
            rows={6}
            style={{ width: '100%', marginBottom: '0.75rem', resize: 'vertical' }}
          />
          <button type="button" className="btn btn-primary" onClick={handleExtract} disabled={loading} style={{ marginBottom: '1rem' }}>
            {loading ? 'Extracting…' : 'Extract transactions'}
          </button>

          {hasExtractedButEmpty && (
            <p style={{ color: '#666', marginBottom: '1rem' }}>No transactions were found in the pasted text. Try pasting more messages or check the format.</p>
          )}

          {extracted.length > 0 && (
            <>
              <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem 0' }}>Confirm categorization (one row per vendor)</h3>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: '#666' }}>
                This step is only to teach the AI how you categorize each vendor. Pick the correct category and click the checkmark; the row disappears. No transactions are added yet. You can optionally import them in the next step.
              </p>
              <div style={{ marginBottom: '1rem' }}>
                {merchantRows.length === 0 ? (
                  <div style={{ padding: '1rem 0' }}>
                    <p style={{ color: '#666', margin: '0 0 0.75rem 0' }}>
                      Categorization confirmed for {new Set(extracted.map((tx) => merchantKey(tx.merchant))).size} vendor(s). You can import these as transactions now or skip to the next step.
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={async () => {
                          await handleConfirmExtracted();
                        }}
                        disabled={loading}
                      >
                        {loading ? 'Importing…' : 'Import all as transactions'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setStep(3)}
                      >
                        Skip to next step
                      </button>
                    </div>
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {merchantRows.map(({ merchant, suggestedCategory, count }) => (
                      <li
                        key={merchant}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                          padding: '0.6rem 0',
                          borderBottom: '1px solid #eee',
                        }}
                      >
                        <span style={{ minWidth: 140, fontWeight: 500 }}>
                          {merchant}
                          {count > 1 && (
                            <span style={{ marginLeft: '0.35rem', color: '#666', fontWeight: 400, fontSize: '0.85rem' }}>
                              ({count})
                            </span>
                          )}
                        </span>
                        <span style={{ color: '#666', fontSize: '0.9rem', minWidth: 100 }}>
                          Suggested: {suggestedCategory || '—'}
                        </span>
                        <select
                          className="input"
                          value={getCategoryIdForMerchant(merchant, suggestedCategory)}
                          onChange={(e) => setReviewChoiceForMerchant(merchant, e.target.value)}
                          style={{ minWidth: 140 }}
                        >
                          {userCategories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        {userTags.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                            {userTags.map((t) => (
                              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.85rem' }}>
                                <input
                                  type="checkbox"
                                  checked={(reviewChoicesByMerchant[merchant]?.tag_ids ?? []).includes(t.id)}
                                  onChange={() => toggleReviewTagForMerchant(merchant, suggestedCategory, t.id)}
                                />
                                {t.name}
                              </label>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => confirmMerchant(merchant, suggestedCategory)}
                          title="Confirm category (uses selection in dropdown)"
                          style={{ marginLeft: 'auto' }}
                        >
                          ✓ Confirm
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {merchantRows.length > 0 && (
                <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
                  Confirm each vendor above, then you can import as transactions or skip to the next step.
                </p>
              )}
            </>
          )}
          <p style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
          </p>
        </div>
      )}

      {/* Step 3: Budgets optional */}
      {step === 3 && (
        <div className="card" style={{ maxWidth: 480 }}>
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0' }}>Set budget goals (optional)</h2>
          <p style={{ margin: '0 0 1rem 0', color: '#666', fontSize: '0.95rem' }}>
            You can set monthly budgets per category now or later from Settings.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link to="/budgets" className="btn btn-secondary">
              Set budgets now
            </Link>
            <button type="button" className="btn btn-primary" onClick={handleFinish} disabled={loading}>
              {loading ? 'Finishing…' : 'Finish setup'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
