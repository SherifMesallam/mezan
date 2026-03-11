-- Revert: remove month_start_day from UserSettings
ALTER TABLE "UserSettings" DROP COLUMN IF EXISTS "month_start_day";
