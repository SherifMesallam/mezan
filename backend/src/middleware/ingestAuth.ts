import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import * as bcrypt from 'bcryptjs';

export interface IngestRequest extends Request {
  ingestUserId?: string;
}

export async function ingestAuthMiddleware(
  req: IngestRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = authHeader.slice(7);
  const settings = await prisma.userSettings.findMany({
    where: { ingestTokenHash: { not: null } },
    include: { user: true },
  });
  for (const s of settings) {
    if (s.ingestTokenHash && (await bcrypt.compare(token, s.ingestTokenHash))) {
      req.ingestUserId = s.userId;
      next();
      return;
    }
  }
  res.status(401).json({ error: 'Invalid ingest token' });
}
