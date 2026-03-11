/**
 * Fix transactions where day and month were swapped (e.g. 11 March stored as 3 November).
 * Only considers dates where both month and day are <= 12 and different (ambiguous when parsed as MM-DD).
 *
 * Run from backend:
 *   npx ts-node -r dotenv/config scripts/fix-swapped-dates.ts         # dry run (list only)
 *   npx ts-node -r dotenv/config scripts/fix-swapped-dates.ts --apply   # apply fixes
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function isAmbiguousYYYYMMDD(dateStr: string): boolean {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return month <= 12 && day <= 12 && month !== day;
}

/** Swap day and month in YYYY-MM-DD. */
function swapDayMonth(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  const [, y, mon, d] = m;
  return `${y}-${d}-${mon}`;
}

async function main() {
  const transactions = await prisma.transaction.findMany({
    select: { id: true, date: true, merchant: true },
  });

  const candidates = transactions.filter((t) => isAmbiguousYYYYMMDD(t.date));
  if (candidates.length === 0) {
    console.log('No transactions with ambiguous day/month (both <= 12 and different).');
    return;
  }

  console.log(`Found ${candidates.length} transaction(s) with possibly swapped day/month.\n`);
  console.log('ID (short)   | Current date  | Corrected (swap) | Merchant');
  console.log('-'.repeat(75));

  let updated = 0;
  for (const t of candidates) {
    const corrected = swapDayMonth(t.date);
    const merchant = (t.merchant || '—').slice(0, 25);
    console.log(`${t.id.slice(0, 8)}…     | ${t.date}       | ${corrected}            | ${merchant}`);
    if (APPLY) {
      await prisma.transaction.update({
        where: { id: t.id },
        data: { date: corrected },
      });
      updated += 1;
    }
  }

  if (APPLY) {
    console.log(`\nUpdated ${updated} transaction(s).`);
  } else {
    console.log('\nDry run. Run with --apply to fix these dates.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
