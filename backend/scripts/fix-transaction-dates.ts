/**
 * One-off script: fix existing transactions whose `date` is not YYYY-MM-DD.
 * Run from backend: npm run scripts:fix-transaction-dates
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { normalizeDateToYYYYMMDD } from '../src/lib/date';

const prisma = new PrismaClient();

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/; // only exact YYYY-MM-DD is valid

async function main() {
  const all = await prisma.transaction.findMany({
    select: { id: true, date: true },
  });

  const bad = all.filter((t) => !VALID_DATE.test(t.date));
  if (bad.length === 0) {
    console.log('No transactions with invalid date format found.');
    return;
  }

  console.log(`Found ${bad.length} transaction(s) with non-YYYY-MM-DD date. Fixing...`);

  let updated = 0;
  let skipped = 0;

  for (const t of bad) {
    const normalized = normalizeDateToYYYYMMDD(t.date);
    if (!normalized) {
      console.warn(`  Skip id=${t.id} date="${t.date}" (could not parse)`);
      skipped += 1;
      continue;
    }
    if (normalized === t.date) {
      skipped += 1;
      continue;
    }
    await prisma.transaction.update({
      where: { id: t.id },
      data: { date: normalized },
    });
    console.log(`  ${t.id}: "${t.date}" → "${normalized}"`);
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
