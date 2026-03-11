import { prisma } from './prisma';

const DEFAULT_CATEGORIES = [
  { name: 'Food', nameAr: 'طعام', sortOrder: 1 },
  { name: 'Transport', nameAr: 'مواصلات', sortOrder: 2 },
  { name: 'Bills', nameAr: 'فواتير', sortOrder: 3 },
  { name: 'Shopping', nameAr: 'تسوق', sortOrder: 4 },
  { name: 'Other', nameAr: 'أخرى', sortOrder: 5 },
];

/**
 * Creates default categories for the user if they have none.
 * Idempotent: only runs when user has zero categories.
 */
export async function ensureDefaultCategories(userId: string): Promise<void> {
  const count = await prisma.category.count({ where: { userId } });
  if (count > 0) return;

  for (const d of DEFAULT_CATEGORIES) {
    await prisma.category.create({
      data: {
        userId,
        name: d.name,
        nameAr: d.nameAr,
        isSystem: true,
        sortOrder: d.sortOrder,
      },
    });
  }
}
