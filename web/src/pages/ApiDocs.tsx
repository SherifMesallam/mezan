import { Link } from 'react-router-dom';

const BASE = import.meta.env.VITE_API_URL || '/api';

export default function ApiDocs() {
  return (
    <div className="api-docs-page">
      <div className="api-docs">
      <header className="api-docs-header">
        <h1>Mezan API</h1>
        <p className="api-docs-subtitle">
          REST API for the Mezan expense tracker. Use it to build integrations, mobile apps, or automation.
        </p>
        <p>
          <Link to="/">← Back to Mezan</Link>
        </p>
      </header>

      <section className="api-docs-section">
        <h2>Overview</h2>
        <p>
          The API is exposed at <code>{BASE}/v1</code>. Most endpoints require authentication via a JWT token.
          CORS is enabled, so you can call the API from web apps, mobile apps, or scripts.
        </p>
      </section>

      <section className="api-docs-section">
        <h2>Authentication</h2>
        <h3>JWT (main app)</h3>
        <p>
          Sign up or log in to get a token. Include it in all requests:
        </p>
        <pre>
{`Authorization: Bearer <your_token>`}
        </pre>
        <table className="api-docs-table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Auth</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>POST /v1/auth/signup</code></td>
              <td>None</td>
              <td>Create account. Body: <code>{`{ email, password }`}</code>. Returns <code>{`{ user, token }`}</code>.</td>
            </tr>
            <tr>
              <td><code>POST /v1/auth/login</code></td>
              <td>None</td>
              <td>Log in. Body: <code>{`{ email, password }`}</code>. Returns <code>{`{ user, token }`}</code>.</td>
            </tr>
          </tbody>
        </table>

        <h3>Ingest token (external integrations)</h3>
        <p>
          For Zapier, IFTTT, or custom scripts that add transactions without the full app. Generate an ingest token in{' '}
          <strong>Settings → Ingest token</strong>. Use it as:
        </p>
        <pre>
{`Authorization: Bearer <ingest_token>`}
        </pre>
        <p>
          Ingest endpoints create transactions for the user who owns the token. No JWT needed.
        </p>
      </section>

      <section className="api-docs-section">
        <h2>Endpoints</h2>

        <h3>Health</h3>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /health</code></td>
              <td>None</td>
              <td>Returns <code>{`{ status: "ok" }`}</code>. Use for uptime checks.</td>
            </tr>
          </tbody>
        </table>

        <h3>Transactions</h3>
        <p>All require JWT.</p>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /v1/transactions</code></td>
              <td>JWT</td>
              <td>List transactions. Query: <code>from</code>, <code>to</code> (YYYY-MM-DD), <code>category_id</code>, <code>tag_id</code>, <code>q</code> (search), <code>limit</code> (default 50, max 2000).</td>
            </tr>
            <tr>
              <td><code>GET /v1/transactions/date-range</code></td>
              <td>JWT</td>
              <td>Min/max dates and total count.</td>
            </tr>
            <tr>
              <td><code>POST /v1/transactions</code></td>
              <td>JWT</td>
              <td>Create. Body: <code>{`{ amount, currency?, date?, time?, merchant?, category_id?, tag_ids? }`}</code>.</td>
            </tr>
            <tr>
              <td><code>PATCH /v1/transactions/:id</code></td>
              <td>JWT</td>
              <td>Update transaction.</td>
            </tr>
            <tr>
              <td><code>DELETE /v1/transactions/:id</code></td>
              <td>JWT</td>
              <td>Delete transaction.</td>
            </tr>
          </tbody>
        </table>

        <h3>Categories</h3>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /v1/categories</code></td>
              <td>JWT</td>
              <td>List categories.</td>
            </tr>
            <tr>
              <td><code>POST /v1/categories</code></td>
              <td>JWT</td>
              <td>Create. Body: <code>{`{ name, name_ar?, parent_id? }`}</code>.</td>
            </tr>
            <tr>
              <td><code>PATCH /v1/categories/:id</code></td>
              <td>JWT</td>
              <td>Update category.</td>
            </tr>
            <tr>
              <td><code>DELETE /v1/categories/:id</code></td>
              <td>JWT</td>
              <td>Delete category.</td>
            </tr>
          </tbody>
        </table>

        <h3>Tags</h3>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /v1/tags</code></td>
              <td>JWT</td>
              <td>List tags.</td>
            </tr>
            <tr>
              <td><code>POST /v1/tags</code></td>
              <td>JWT</td>
              <td>Create. Body: <code>{`{ name, name_ar? }`}</code>.</td>
            </tr>
            <tr>
              <td><code>PATCH /v1/tags/:id</code></td>
              <td>JWT</td>
              <td>Update tag.</td>
            </tr>
            <tr>
              <td><code>DELETE /v1/tags/:id</code></td>
              <td>JWT</td>
              <td>Delete tag.</td>
            </tr>
          </tbody>
        </table>

        <h3>Budgets</h3>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /v1/budgets</code></td>
              <td>JWT</td>
              <td>List budgets. Query: <code>month</code> (YYYY-MM).</td>
            </tr>
            <tr>
              <td><code>POST /v1/budgets</code></td>
              <td>JWT</td>
              <td>Create. Body: <code>{`{ scope_type, scope_id?, amount, currency?, month? }`}</code>. scope_type: total_monthly, category, sub_category, tag.</td>
            </tr>
          </tbody>
        </table>

        <h3>Insights</h3>
        <p>All require JWT. Query: <code>from</code>, <code>to</code> (YYYY-MM-DD), <code>month</code> (YYYY-MM).</p>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /v1/insights/summary</code></td>
              <td>JWT</td>
              <td>Spending summary by category.</td>
            </tr>
            <tr>
              <td><code>GET /v1/insights/budget-status</code></td>
              <td>JWT</td>
              <td>Budget vs actual.</td>
            </tr>
            <tr>
              <td><code>GET /v1/insights/spending-patterns</code></td>
              <td>JWT</td>
              <td>By hour, day of week, merchant.</td>
            </tr>
            <tr>
              <td><code>GET /v1/insights/predict-end-of-month</code></td>
              <td>JWT</td>
              <td>Projected spending.</td>
            </tr>
            <tr>
              <td><code>GET /v1/insights/spending-explanation</code></td>
              <td>JWT</td>
              <td>AI-generated summary (requires OPENAI_API_KEY).</td>
            </tr>
            <tr>
              <td><code>GET /v1/insights/anomalies</code></td>
              <td>JWT</td>
              <td>Unusual spending detection.</td>
            </tr>
          </tbody>
        </table>

        <h3>Users</h3>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /v1/users/me</code></td>
              <td>JWT</td>
              <td>Current user and settings.</td>
            </tr>
            <tr>
              <td><code>POST /v1/users/me/ingest-token</code></td>
              <td>JWT</td>
              <td>Generate or rotate ingest token. Returns <code>{`{ ingest_token }`}</code>.</td>
            </tr>
            <tr>
              <td><code>GET /v1/users/export</code></td>
              <td>JWT</td>
              <td>Export transactions as JSON.</td>
            </tr>
          </tbody>
        </table>

        <h3>Ingest (external integrations)</h3>
        <p>Require <strong>ingest token</strong> (not JWT).</p>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>POST /v1/ingest/parsed</code></td>
              <td>Ingest</td>
              <td>Add a pre-parsed transaction. Body: <code>{`{ amount, currency?, date?, time?, anonymized_text?, location_tile? }`}</code>.</td>
            </tr>
            <tr>
              <td><code>POST /v1/ingest/raw-sms</code></td>
              <td>Ingest</td>
              <td>Add from raw SMS text. Body: <code>{`{ raw_text }`}</code>. Uses AI to extract (requires OPENAI_API_KEY).</td>
            </tr>
          </tbody>
        </table>

        <h3>Import (SMS, image, voice, sheet)</h3>
        <p>All require JWT. Used by the merge wizard flow.</p>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>POST /v1/import/sms-merge-preview</code></td>
              <td>JWT</td>
              <td>Parse SMS. Body: <code>{`{ raw_text, expected_months? }`}</code>. Returns <code>{`{ items }`}</code>.</td>
            </tr>
            <tr>
              <td><code>POST /v1/import/sms-merge-confirm</code></td>
              <td>JWT</td>
              <td>Confirm items. Body: <code>{`{ items: [{ sheet_index, action, matched_entry_id?, category_id?, tag_ids?, ... }] }`}</code>.</td>
            </tr>
            <tr>
              <td><code>POST /v1/import/image-merge-preview</code></td>
              <td>JWT</td>
              <td>OCR + extract from image. Body: <code>{`{ image_base64, mime_type, expected_months? }`}</code>.</td>
            </tr>
            <tr>
              <td><code>POST /v1/import/voice-merge-preview</code></td>
              <td>JWT</td>
              <td>Transcribe + extract from audio. Body: <code>{`{ audio_base64, mime_type? }`}</code>.</td>
            </tr>
            <tr>
              <td><code>POST /v1/import/voice-merge-confirm</code></td>
              <td>JWT</td>
              <td>Confirm voice items. Same body shape as sms-merge-confirm.</td>
            </tr>
            <tr>
              <td><code>POST /v1/import/sheet-merge-preview</code></td>
              <td>JWT</td>
              <td>Parse spreadsheet. Body: <code>{`{ rows, headers? }`}</code>.</td>
            </tr>
            <tr>
              <td><code>POST /v1/import/sheet-merge-confirm</code></td>
              <td>JWT</td>
              <td>Confirm sheet items.</td>
            </tr>
            <tr>
              <td><code>POST /v1/import/data</code></td>
              <td>JWT</td>
              <td>Bulk import transactions.</td>
            </tr>
          </tbody>
        </table>

        <h3>Setup & feedback</h3>
        <table className="api-docs-table">
          <tbody>
            <tr>
              <td><code>GET /v1/setup/status</code></td>
              <td>JWT</td>
              <td>Setup wizard status.</td>
            </tr>
            <tr>
              <td><code>POST /v1/setup/complete</code></td>
              <td>JWT</td>
              <td>Mark setup complete.</td>
            </tr>
            <tr>
              <td><code>POST /v1/feedback/categorization</code></td>
              <td>JWT</td>
              <td>Submit category feedback for learning. Body: <code>{`{ transaction_id, category_id }`}</code>.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="api-docs-section">
        <h2>Errors</h2>
        <p>
          Errors return JSON: <code>{`{ error: "message" }`}</code>. Common status codes: 401 (unauthorized), 422 (validation), 500 (server error).
        </p>
      </section>

      <section className="api-docs-section">
        <h2>Base URL</h2>
        <p>
          The API base URL is configured via <code>VITE_API_URL</code> in the web app. Default: <code>/api</code> (relative to the app origin).
          In production, the API is typically served from the same origin.
        </p>
      </section>
      </div>
    </div>
  );
}
