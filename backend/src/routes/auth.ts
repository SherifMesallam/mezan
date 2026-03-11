import { Router } from 'express';
import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { JwtPayload } from '../middleware/auth';
import { ensureDefaultCategories } from '../lib/seedDefaultCategories';

export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

authRouter.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(422).json({ error: 'Email and password required' });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(422).json({ error: 'Email already registered' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
      },
    });
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        defaultCurrency: 'EGP',
        locale: 'en',
      },
    });
    await ensureDefaultCategories(user.id);
    const token = jwt.sign(
      { userId: user.id, email: user.email } as JwtPayload,
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ user: { id: user.id, email: user.email }, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Signup failed' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(422).json({ error: 'Email and password required' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign(
      { userId: user.id, email: user.email } as JwtPayload,
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});
