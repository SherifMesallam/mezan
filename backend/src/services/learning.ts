import { prisma } from '../lib/prisma';

export interface RecordFeedbackInput {
  merchantNormalized: string;
  categoryName: string;
  region?: string;
}

/**
 * Record anonymized feedback when a user confirms or corrects a category.
 * No user_id or raw message stored — used for LLM few-shot learning.
 */
export async function recordCategoryFeedback(input: RecordFeedbackInput): Promise<void> {
  const normalized = (input.merchantNormalized || '').toLowerCase().trim().slice(0, 200);
  const categoryName = (input.categoryName || '').trim().slice(0, 100);
  const region = (input.region || 'EG').toUpperCase().slice(0, 10);

  if (!normalized || !categoryName) return;

  await prisma.categorySuggestionSignal.create({
    data: {
      merchantNormalized: normalized,
      categoryName,
      region,
    },
  });
}

/**
 * Fetch learning examples for few-shot prompting: top (merchant → category) by region.
 */
export async function getLearningExamples(
  region: string = 'EG',
  limit: number = 20
): Promise<Array<{ merchantNormalized: string; categoryName: string }>> {
  const signals = await prisma.categorySuggestionSignal.findMany({
    where: { region: region.toUpperCase() },
    select: { merchantNormalized: true, categoryName: true },
    take: limit * 3,
  });

  const count = new Map<string, { category: string; n: number }>();
  for (const s of signals) {
    const key = `${s.merchantNormalized}::${s.categoryName}`;
    const prev = count.get(key);
    if (prev) prev.n += 1;
    else count.set(key, { category: s.categoryName, n: 1 });
  }

  const sorted = [...count.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([key, v]) => {
      const [merchantNormalized] = key.split('::');
      return { merchantNormalized, categoryName: v.category };
    });

  return sorted;
}
