/**
 * Diagnostic: list each category with transaction count and total amount per user.
 * Run from backend: npx ts-node -r dotenv/config scripts/category-counts.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
  });
  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  for (const user of users) {
    const [categories, counts] = await Promise.all([
      prisma.category.findMany({
        where: { userId: user.id },
        orderBy: [{ name: 'asc' }],
        select: { id: true, name: true, parentId: true },
      }),
      prisma.transaction.groupBy({
        by: ['categoryId'],
        where: { userId: user.id },
        _count: { id: true },
        _sum: { amount: true },
      }),
    ]);
    const byCat = new Map(
      counts.map((c) => [c.categoryId, { count: c._count.id, total: Number(c._sum.amount ?? 0) }])
    );

    console.log(`\nUser: ${user.email ?? user.id}`);
    console.log('Category name                      | id (short)     | transactions | total (EGP)');
    console.log('-'.repeat(85));
    for (const c of categories) {
      const v = byCat.get(c.id);
      const count = v?.count ?? 0;
      const total = Math.round((v?.total ?? 0) * 100) / 100;
      const idShort = c.id.slice(0, 8) + '…';
      const namePad = c.name.padEnd(32).slice(0, 32);
      console.log(`${namePad} | ${idShort.padEnd(14)} | ${String(count).padStart(12)} | ${total.toFixed(2)}`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
