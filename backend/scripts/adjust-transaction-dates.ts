/**
 * One-off script: add 1 year to all transaction dates (e.g. 2025 → 2026).
 * Run from backend: npm run scripts:adjust-transaction-dates
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ADD_YEARS = 1;

function addYearsToDate(dateStr: string, years: number): string | null {
  if (!VALID_DATE.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setFullYear(dt.getFullYear() + years);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function main() {
  const all = await prisma.transaction.findMany({
    select: { id: true, date: true },
  });

  if (all.length === 0) {
    console.log('No transactions found.');
    return;
  }

  console.log(`Found ${all.length} transaction(s). Adding ${ADD_YEARS} year(s) to each date...`);

  let updated = 0;
  let skipped = 0;

  for (const t of all) {
    const newDate = addYearsToDate(String(t.date).trim(), ADD_YEARS);
    if (!newDate || newDate === t.date) {
      skipped += 1;
      continue;
    }
    await prisma.transaction.update({
      where: { id: t.id },
      data: { date: newDate },
    });
    console.log(`  ${t.id}: "${t.date}" → "${newDate}"`);
    updated += 1;
  }

  console.log(`Done. Updated ${updated}, skipped ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
