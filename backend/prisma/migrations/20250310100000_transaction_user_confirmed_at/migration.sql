-- Add user_confirmed_at to Transaction: set when user edits category or tags (for AI learning).
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "user_confirmed_at" TIMESTAMP(3);
