import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { recordCategoryFeedback } from '../services/learning';

/**
 * Anonymous categorization feedback for the learning loop.
 * When user confirms or corrects a category, client can POST here
 * so we improve future LLM suggestions without storing user id with the signal.
 */
export const feedbackRouter = Router();
feedbackRouter.use(authMiddleware);

feedbackRouter.post('/categorization', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { merchant_normalized, category_id } = req.body as {
      merchant_normalized?: string;
      category_id?: string;
    };

    if (!merchant_normalized || !category_id) {
      res.status(422).json({ error: 'merchant_normalized and category_id are required' });
      return;
    }

    const category = await prisma.category.findFirst({
      where: { id: category_id, userId },
    });
    if (!category) {
      res.status(422).json({ error: 'Category not found' });
      return;
    }

    const region = await getRegionForUser(userId);
    await recordCategoryFeedback({
      merchantNormalized: String(merchant_normalized).trim().toLowerCase().slice(0, 200),
      categoryName: category.name,
      region,
    });

    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

async function getRegionForUser(userId: string): Promise<string> {
  const s = await prisma.userSettings.findUnique({
    where: { userId },
    select: { locale: true },
  });
  if (s?.locale === 'ar-EG' || s?.locale?.toLowerCase().includes('eg')) return 'EG';
  if (s?.locale?.toLowerCase().includes('sa')) return 'SA';
  if (s?.locale?.toLowerCase().includes('ae')) return 'AE';
  return 'EG';
}
