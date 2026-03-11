import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const tagsRouter = Router();
tagsRouter.use(authMiddleware);

tagsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const tags = await prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    res.json({
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        name_ar: t.nameAr,
        color: t.color,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list tags' });
  }
});

tagsRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { name, name_ar, color } = req.body as { name: string; name_ar?: string; color?: string };

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(422).json({ error: 'name is required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(401).json({
        error: 'Your account was not found. Please log out and sign in again (e.g. after a database reset).',
      });
      return;
    }

    const tag = await prisma.tag.create({
      data: {
        userId,
        name: name.trim(),
        nameAr: name_ar != null ? String(name_ar) : null,
        color: color != null ? String(color) : null,
      },
    });

    res.status(201).json({
      id: tag.id,
      name: tag.name,
      name_ar: tag.nameAr,
      color: tag.color,
    });
  } catch (e) {
    console.error(e);
    const err = e as { code?: string };
    if (err?.code === 'P2003') {
      res.status(401).json({
        error: 'Your account was not found. Please log out and sign in again (e.g. after a database reset).',
      });
      return;
    }
    res.status(500).json({ error: 'Failed to create tag' });
  }
});

tagsRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const id = req.params.id;
    const { name, name_ar, color } = req.body;

    const existing = await prisma.tag.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (name != null) data.name = String(name).trim();
    if (name_ar !== undefined) data.nameAr = name_ar ? String(name_ar) : null;
    if (color !== undefined) data.color = color ? String(color) : null;

    const updated = await prisma.tag.update({
      where: { id },
      data,
    });

    res.json({
      id: updated.id,
      name: updated.name,
      name_ar: updated.nameAr,
      color: updated.color,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update tag' });
  }
});

tagsRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const id = req.params.id;

    const existing = await prisma.tag.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Tag not found' });
      return;
    }

    await prisma.tag.delete({ where: { id } });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});
