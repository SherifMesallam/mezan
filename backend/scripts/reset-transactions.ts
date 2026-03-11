/**
 * One-off script: delete ALL transactions (and their tags via cascade).
 * Leaves users, categories, budgets, tags, settings, etc. unchanged.
 * Run from backend: npm run scripts:reset-transactions
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tagCount = await prisma.transactionTag.count();
  const txCount = await prisma.transaction.count();

  if (txCount === 0) {
    console.log('No transactions to delete.');
    return;
  }

  console.log(`About to delete ${txCount} transaction(s) and ${tagCount} transaction-tag link(s).`);
  console.log('Users, categories, budgets, tags, and settings will NOT be changed.');

  await prisma.transaction.deleteMany({});

  console.log('Done. All transactions have been removed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
