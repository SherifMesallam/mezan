import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAuth(handler: (req: AuthRequest, res: Response) => void | Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    authMiddleware(req as AuthRequest, res, () => {
      const result = handler(req as AuthRequest, res);
      if (result != null && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(next);
      }
    });
  };
}
