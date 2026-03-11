import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth';

export const categoriesRouter = Router();
categoriesRouter.use(authMiddleware);

categoriesRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const categories = await prisma.category.findMany({
      where: { userId },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { id: true, name: true, nameAr: true } },
        children: { select: { id: true, name: true, nameAr: true, sortOrder: true } },
        _count: { select: { transactions: true } },
      },
    });

    const list = categories.map(
      (c: (typeof categories)[number]) => ({
        id: c.id,
        user_id: c.userId,
        parent_id: c.parentId,
        parent: c.parent,
        name: c.name,
        name_ar: c.nameAr,
        icon: c.icon,
        color: c.color,
        is_system: c.isSystem,
        sort_order: c.sortOrder,
        children: c.children,
        transaction_count: c._count.transactions,
      })
    );

    res.json({ categories: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to list categories' });
  }
});

categoriesRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { name, parent_id, name_ar, icon, color } = req.body as {
      name: string;
      parent_id?: string | null;
      name_ar?: string;
      icon?: string;
      color?: string;
    };

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

    if (parent_id) {
      const parent = await prisma.category.findFirst({
        where: { id: parent_id, userId },
      });
      if (!parent) {
        res.status(422).json({ error: 'Parent category not found' });
        return;
      }
    }

    const category = await prisma.category.create({
      data: {
        userId,
        name: name.trim(),
        nameAr: name_ar != null ? String(name_ar) : null,
        parentId: parent_id || null,
        icon: icon != null ? String(icon) : null,
        color: color != null ? String(color) : null,
        isSystem: false,
      },
    });

    res.status(201).json({
      id: category.id,
      parent_id: category.parentId,
      name: category.name,
      name_ar: category.nameAr,
      icon: category.icon,
      color: category.color,
      is_system: category.isSystem,
      sort_order: category.sortOrder,
    });
  } catch (e) {
    console.error(e);
    const err = e as { code?: string; meta?: { target?: string[] } };
    if (err?.code === 'P2003') {
      res.status(401).json({
        error: 'Your account was not found. Please log out and sign in again (e.g. after a database reset).',
      });
      return;
    }
    res.status(500).json({ error: 'Failed to create category' });
  }
});

categoriesRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const id = req.params.id;
    const { name, name_ar, parent_id, icon, color, sort_order } = req.body;

    const existing = await prisma.category.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (name != null) data.name = String(name).trim();
    if (name_ar !== undefined) data.nameAr = name_ar ? String(name_ar) : null;
    if (parent_id !== undefined) {
      if (parent_id && parent_id !== id) {
        const parent = await prisma.category.findFirst({ where: { id: parent_id, userId } });
        if (!parent) {
          res.status(422).json({ error: 'Parent category not found' });
          return;
        }
      }
      data.parentId = parent_id || null;
    }
    if (icon !== undefined) data.icon = icon ? String(icon) : null;
    if (color !== undefined) data.color = color ? String(color) : null;
    if (sort_order != null) data.sortOrder = parseInt(String(sort_order)) || 0;

    const updated = await prisma.category.update({
      where: { id },
      data,
    });

    res.json({
      id: updated.id,
      parent_id: updated.parentId,
      name: updated.name,
      name_ar: updated.nameAr,
      icon: updated.icon,
      color: updated.color,
      is_system: updated.isSystem,
      sort_order: updated.sortOrder,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

categoriesRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const id = req.params.id;

    const existing = await prisma.category.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    await prisma.category.delete({ where: { id } });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});
