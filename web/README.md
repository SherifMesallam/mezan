# Mezan Web

Web UI for the Mezan expense tracker. Sign in and use the **SMS** screen to paste transaction SMS, parse, and add to your account.

## Setup

```bash
cd web
npm install
```

## Run

With the API running on port 3000:

```bash
npm run dev
```

Open http://localhost:5173. The dev server proxies `/v1/*` to the backend.

## Build

```bash
npm run build
npm run preview   # serve dist/
```

For production, set `VITE_API_URL` to your API origin (e.g. `https://api.mezan.app`) so requests go to the correct host.

## Deploy with Docker (e.g. Railway)

The repo includes a **Dockerfile** that builds the app and serves it with nginx. The API URL is fixed at **build time**.

```bash
# Build (set your backend URL)
docker build -t mezan-web --build-arg VITE_API_URL=https://your-backend.up.railway.app web

# Run (port 8080)
docker run -p 8080:8080 -e PORT=8080 mezan-web
```

On **Railway**: add a service from the same repo with **Root directory** `web` and **Dockerfile** builder. Set the variable **VITE_API_URL** to your backend URL (Railway passes it as a build arg). See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

## Features

- **Log in / Sign up** – JWT stored in `localStorage`
- **Home** – This month total, budget status preview, recent transactions (with links to Charts and Budgets)
- **Add transaction** – Manual entry: amount, merchant, category, date/time, tags
- **Add from SMS** – Paste SMS text → Parse (amount, date, anonymized vendor hint) → Add transaction via ingest API. Ingest token is fetched once and stored for subsequent requests.
- **Charts** – Spending summary by category, tag, or day (pie chart + list)
- **Budgets** – List budgets with spent/remaining for the current month
- **Categories** – List categories
- **Tags** – List tags
- **Settings** – Generate ingest token, log out
