import { Router } from 'express';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const usersRouter = Router();
usersRouter.use(authMiddleware);

usersRouter.get('/me', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });
    const inboundEmail = settings?.inboundEmailLocal
      ? `${settings.inboundEmailLocal}@inbound.mezan.app`
      : null;
    res.json({
      ...user,
      ingest_token: settings?.ingestTokenHash ? '••••••••' : null,
      inbound_email: inboundEmail,
      default_currency: settings?.defaultCurrency,
      locale: settings?.locale,
      setup_completed_at: settings?.setupCompletedAt?.toISOString() ?? null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

usersRouter.post('/me/ingest-token', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const rawToken = uuidv4() + '-' + uuidv4();
    const hash = await bcrypt.hash(rawToken, 10);
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ingestTokenHash: hash, defaultCurrency: 'EGP', locale: 'en' },
      update: { ingestTokenHash: hash },
    });
    res.json({ ingest_token: rawToken });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to rotate ingest token' });
  }
});
