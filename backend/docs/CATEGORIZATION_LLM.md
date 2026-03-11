# LLM categorization and learning loop

## Overview

- **Categorization** is done on the server using an LLM when `OPENAI_API_KEY` is set.
- Input: **anonymized_text** (vendor/merchant names only, no numbers) and optional **location_tile**.
- Output: **suggested_category_id** from the user's categories.
- If the LLM is not configured or the call fails, a **rule-based fallback** (keywords for Food, Transport, Bills) is used.

## Configuration

In `.env`:

- `OPENAI_API_KEY` – Required for LLM; if missing, only rules are used.
- `OPENAI_BASE_URL` – Optional; default `https://api.openai.com/v1` (use for Azure or other OpenAI-compatible endpoints).
- `OPENAI_MODEL` – Optional; default `gpt-4o-mini`.

## Learning loop

1. **Feedback**  
   When a user **confirms** or **corrects** a category:
   - **PATCH `/v1/transactions/:id`** with a new `category_id` and the transaction has a `merchant` → we store an anonymized signal.
   - **POST `/v1/feedback/categorization`** with `merchant_normalized` and `category_id` → we look up the category name and store a signal (no user id).

2. **Stored signal**  
   In `category_suggestion_signals` we store only:
   - `merchant_normalized` (e.g. `"fawry"`)
   - `category_name` (e.g. `"Bills"`)
   - `region` (e.g. `"EG"`)

3. **Few-shot prompting**  
   When suggesting a category, we load recent learning examples for the user’s region and pass them to the LLM as few-shot examples (e.g. `"fawry" → Bills`), so later suggestions improve.

## API

- **Ingest:** `POST /v1/ingest/parsed` – uses LLM (or rules) to set `suggested_category_id`.
- **Confirm/correct:** `PATCH /v1/transactions/:id` with `category_id`, or `POST /v1/feedback/categorization` with `merchant_normalized` and `category_id`.
