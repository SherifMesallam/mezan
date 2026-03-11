/**
 * One-off diagnostic: print transaction counts per user and sample dates/sources.
 * Run from backend: npx ts-node -r dotenv/config scripts/list-transaction-stats.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  console.log(`Users: ${users.length}`);
  for (const u of users) {
    const count = await prisma.transaction.count({ where: { userId: u.id } });
    const bySource = await prisma.transaction.groupBy({
      by: ['source'],
      where: { userId: u.id },
      _count: { id: true },
    });
    const dateRange = await prisma.transaction.aggregate({
      where: { userId: u.id },
      _min: { date: true },
      _max: { date: true },
    });
    const sample = await prisma.transaction.findMany({
      where: { userId: u.id },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, date: true, amount: true, source: true, createdAt: true },
    });
    console.log(`  ${u.email}: ${count} transactions, date range ${dateRange._min.date} to ${dateRange._max.date}`);
    console.log(`  by source:`, bySource.map((s) => `${s.source}=${s._count.id}`).join(', '));
    sample.forEach((t) => {
      console.log(`    date="${t.date}" amount=${t.amount} source=${t.source} id=${t.id.slice(0, 8)}...`);
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
