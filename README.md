# Mezan

Expense tracker for Egypt/MENA – backend API, web UI, and mobile app.

## Run on localhost (web interface)

Use two terminals (or the one-command option below).

### 1. Database (Docker)

From the **mezan** root:

```bash
docker compose up -d db
```

This starts PostgreSQL 16 on port 5432 with database `mezan` (user `postgres`, password `postgres`). The `backend/.env` is already set to use it.

To apply the schema after pulling code changes:

```bash
cd backend && npx prisma db push
```

### 2. Backend (API)

**Prerequisites:** Node 18+. Database must be running (see above).

```bash
cd backend
npm install
npm run dev
```

API runs at **http://localhost:3000**. Leave this terminal open. (The repo includes a `backend/.env` for local dev; for a fresh clone, copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL`, `JWT_SECRET`, and `INGEST_TOKEN_SECRET`.)

### 3. Web UI

In a **second terminal**:

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173** in your browser. The web app proxies `/v1` to the backend.

### One command (optional)

From the **mezan** root directory:

```bash
npm install
npm run dev
```

This starts both backend and web (requires `concurrently`; see root `package.json`). Then open http://localhost:5173.

---

## Project layout

| Directory | Description |
|-----------|-------------|
| **backend** | Express API (auth, transactions, categories, tags, budgets, ingest, insights) |
| **web** | React + Vite web UI – login, SMS paste screen |
| **mobile** | Flutter app (manual entry, Add from SMS, charts, budgets) |

## Health check

- Backend: http://localhost:3000/health  
- Web: http://localhost:5173 (after `npm run dev` in `web/`)
