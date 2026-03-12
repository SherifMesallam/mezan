# Deploying Mezan (backend + web)

Deploy the backend so it’s publicly reachable, then deploy the web app (and optionally point the mobile app at the same URL).

---

## One-step deploy (recommended on Railway)

A **single Dockerfile** at the repo root builds the backend and web, then runs one process: the API serves `/v1/*` and the web app (same origin). One service, one deploy.

1. **Railway:** New project → **Deploy from GitHub** → select your repo.
2. **Settings:** Leave **Root directory** empty (or `.`). Railway will use the root **Dockerfile**.
3. **Variables:** Set only backend env vars (no `VITE_API_URL` needed):
   - `DATABASE_URL` – from Railway Postgres (add **PostgreSQL** in the same project and link it).
   - `JWT_SECRET` – long random string.
   - `INGEST_TOKEN_SECRET` – long random string.
   - Optional: `OPENAI_API_KEY`, etc.
4. **Domain:** Generate a domain. The app is at e.g. `https://mezan-production.up.railway.app` (API at `/v1/*`, web at `/`).
5. **First deploy:** The image runs `prisma migrate deploy` then starts the server. Ensure `backend/prisma/migrations` exists.

**Mobile:** Set the app’s **API server URL** to that same URL (e.g. `https://mezan-production.up.railway.app`).

---

## 1. Deploy the backend (separate services)

You need:

- **PostgreSQL** (hosted, e.g. Railway, Render, Neon, Supabase)
- **Node** app that runs `prisma migrate`, then `npm start`

### Option A: Railway

1. **Create a project** at [railway.app](https://railway.app) and add:
   - **PostgreSQL** (from “New” → “Database” → “PostgreSQL”).
   - **GitHub repo** (or “Empty” and connect repo later).

2. **Backend service** (from “New” → “GitHub Repo” → select your repo, root directory `backend` or set in Settings):
   - **Build:** `npm install && npx prisma generate && npm run build`
   - **Start:** `npx prisma migrate deploy && node dist/index.js`
   - **Root directory:** `backend` (if repo is monorepo)

3. **Variables** (Railway → your backend service → Variables). Add or link:
   - `DATABASE_URL` – from the PostgreSQL service (Railway links it automatically if you add the Postgres plugin to the same project).
   - `JWT_SECRET` – long random string (e.g. `openssl rand -hex 32`).
   - `INGEST_TOKEN_SECRET` – another long random string.
   - `PORT` – Railway sets this; you can leave it unset.
   - Optional: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` for LLM categorization.

4. **Domain:** Railway → your service → Settings → Generate domain. You’ll get a URL like `https://mezan-backend-production.up.railway.app`.

5. **Migrations:** On first deploy, the start command runs `prisma migrate deploy`. Ensure migrations exist in `backend/prisma/migrations`.

### Option B: Render

1. **PostgreSQL:** [Render Dashboard](https://dashboard.render.com) → New → PostgreSQL. Note the **Internal Database URL** (or External if you’ll connect from elsewhere).

2. **Web Service:** New → Web Service → connect repo. Settings:
   - **Root directory:** `backend`
   - **Build:** `npm install && npx prisma generate && npm run build`
   - **Start:** `npx prisma migrate deploy && node dist/index.js`
   - **Environment:** Add `DATABASE_URL` (from the Postgres service), `JWT_SECRET`, `INGEST_TOKEN_SECRET`. Optionally `OPENAI_*`.

3. **Domain:** Render assigns a URL like `https://mezan-backend.onrender.com`.

---

## 2. Deploy the web app

The web app calls the API using `VITE_API_URL`. Point it at your deployed backend.

### Build with API URL

```bash
cd web
VITE_API_URL=https://YOUR_BACKEND_URL npm run build
```

Example: `VITE_API_URL=https://mezan-backend-production.up.railway.app npm run build`

The built files are in `web/dist/`. Serve them with any static host.

### Option A: Vercel

1. Connect the repo to [Vercel](https://vercel.com).
2. **Root directory:** `web`
3. **Build command:** `npm run build`
4. **Environment variable:** `VITE_API_URL` = `https://your-backend-url` (no trailing slash)
5. Deploy. The site will be at `https://your-project.vercel.app`.

### Option B: Netlify

1. Connect the repo at [Netlify](https://netlify.com). Root: `web`.
2. Build command: `npm run build`; publish directory: `dist`.
3. Add env var `VITE_API_URL` = `https://your-backend-url`.
4. Deploy.

### Option C: Railway with Docker (web)

The web app has a **Dockerfile** that builds the Vite app and serves it with nginx. Good for deploying the web on Railway alongside your backend.

1. **New service** in the same Railway project: **New** → **GitHub Repo** → select your repo.
2. **Settings:**
   - **Root directory:** `web`
   - **Builder:** Dockerfile (Railway will detect `web/Dockerfile` when root is `web`).
3. **Build argument (required):** In **Variables** (or Build → Build args), add:
   - `VITE_API_URL` = `https://your-backend-url` (your Railway backend URL, no trailing slash).  
   Railway may expose this as a **build-time variable**; if so, add it in the service’s Variables and ensure “Expose to build” or “Build arg” is enabled so the Docker build receives it.
4. **Domain:** Generate a domain for the web service. The app will be at e.g. `https://mezan-web-production.up.railway.app`.
5. **Port:** The image listens on `$PORT`; Railway sets this automatically.

The image uses a multi-stage build (Node for `npm run build`, then nginx to serve `dist`). SPA routing is handled (fallback to `index.html`).

### Option D: Other static hosts

- Build the web app locally with `VITE_API_URL=https://your-backend-url`, then upload `web/dist` to any static host.

---

## 3. CORS

The backend uses `cors()` with no origin restriction, so the deployed web origin can call it. If you want to restrict:

- In `backend/src/index.ts`, set `origin: ['https://your-web-domain.com']` in the `cors()` options.

---

## 4. Mobile app

In the mobile app, set **API server URL** (auth screen or Settings) to your deployed backend URL, e.g. `https://mezan-backend-production.up.railway.app`. No trailing slash.

---

## 5. Checklist

- [ ] PostgreSQL created and `DATABASE_URL` set for backend.
- [ ] `JWT_SECRET` and `INGEST_TOKEN_SECRET` set (strong, random).
- [ ] Backend deploy runs `prisma migrate deploy` (or you ran it once).
- [ ] Backend health: `curl https://your-backend-url/health` → `{"status":"ok"}`.
- [ ] Web built with `VITE_API_URL` pointing at that backend URL.
- [ ] Web deployed; sign up / log in works.
- [ ] Mobile (optional): API server URL set to same backend.
