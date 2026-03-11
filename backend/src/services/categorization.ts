import { prisma } from '../lib/prisma';
import { suggestCategoryWithLLM } from './llm-categorization';
import { getLearningExamples } from './learning';

/**
 * Server-side categorization: input anonymized_text (+ optional location).
 * Uses LLM when OPENAI_API_KEY is set; otherwise falls back to keyword rules.
 * Learning loop: few-shot examples from anonymized feedback improve suggestions.
 */
export async function suggestCategory(
  userId: string,
  anonymizedText: string,
  locationTile?: string | null,
  region: string = 'EG'
): Promise<string | null> {
  const normalized = (anonymizedText || '').trim();
  if (!normalized) return null;

  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: [{ isSystem: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (categories.length === 0) return null;

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) {
    try {
      const learningExamples = await getLearningExamples(region, 20);
      const userCategories = categories.map((c: { id: string; name: string; nameAr: string | null }) => ({
        id: c.id,
        name: c.name,
        nameAr: c.nameAr,
      }));
      const suggested = await suggestCategoryWithLLM(
        {
          apiKey,
          baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
          model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
        },
        normalized,
        userCategories,
        { locationTile, region, learningExamples }
      );
      if (suggested) return suggested;
    } catch (e) {
      console.error('LLM categorization failed, falling back to rules:', e);
    }
  } else if (process.env.NODE_ENV !== 'production') {
    console.debug('suggestCategory: OPENAI_API_KEY not set; using rule-based categorization');
  }

  return suggestCategoryWithRules(normalized, categories);
}

function suggestCategoryWithRules(
  normalized: string,
  categories: Array<{ id: string; name: string; nameAr: string | null }>
): string | null {
  const lower = normalized.toLowerCase();
  const foodKeywords = ['fawry', 'starbucks', 'restaurant', 'cafe', 'مطعم', 'سوبرماركت', 'grocer'];
  const transportKeywords = ['uber', 'careem', 'petrol', 'gas', 'وقود', 'مواصلات'];
  const billsKeywords = ['vodafone', 'orange', 'etisalat', 'we', 'bill', 'فواتير', 'اشتراك'];

  for (const kw of foodKeywords) {
    if (lower.includes(kw)) {
      const food = categories.find((c) => c.name.toLowerCase().includes('food') || c.nameAr?.includes('طعام'));
      return food?.id ?? categories[0].id;
    }
  }
  for (const kw of transportKeywords) {
    if (lower.includes(kw)) {
      const transport = categories.find((c) => c.name.toLowerCase().includes('transport') || c.nameAr?.includes('مواصلات'));
      return transport?.id ?? categories[0].id;
    }
  }
  for (const kw of billsKeywords) {
    if (lower.includes(kw)) {
      const bills = categories.find((c) => c.name.toLowerCase().includes('bill') || c.nameAr?.includes('فواتير'));
      return bills?.id ?? categories[0].id;
    }
  }

  return categories[0].id;
}
