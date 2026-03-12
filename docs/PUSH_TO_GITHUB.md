# Push this repo to GitHub

Your repo is at [https://github.com/SherifMesallam/mezan](https://github.com/SherifMesallam/mezan). One-time setup and push:

## 1. Add the remote (if not already)

```bash
cd /path/to/mezan
git remote add origin https://github.com/SherifMesallam/mezan.git
```

If `origin` already exists and points elsewhere, either rename it or set the URL:

```bash
git remote set-url origin https://github.com/SherifMesallam/mezan.git
```

## 2. Commit and push

```bash
git add .
git status   # check nothing sensitive is staged (no .env, no secrets)
git commit -m "Initial push: backend, web, mobile, one-step Docker deploy"
git branch -M main   # optional: use main as default branch
git push -u origin main
```

If you prefer to keep your current branch name (e.g. `ui-redesign`):

```bash
git push -u origin ui-redesign
```

Then on GitHub you can set the default branch in **Settings → General**.

## 3. What gets pushed

- **Included:** Backend, web, mobile source; root Dockerfile; docs; `.gitignore`; `backend/.env.example`, etc.
- **Ignored (never pushed):** `backend/.env`, `web/.env`, `node_modules/`, `dist/`, `web/dist/`, Flutter build outputs, IDE/OS files. See root `.gitignore`.

Do not commit `.env` files (they contain secrets). The repo already ignores them.
