-- Add month_start_day to UserSettings: day of month that starts the "budget month" (e.g. 23 = 23rd to 22nd)
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "month_start_day" INTEGER NOT NULL DEFAULT 1;
