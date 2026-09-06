import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AppError, asAppError } from '../errors';
import { config } from '../config';
import { userRepo } from '../db/repos';

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; name: string };
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET ?? 'dev-secret-change-me', { expiresIn: '14d' });
}

export function authMiddleware(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) {
    throw AppError.unauthorized();
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET ?? 'dev-secret-change-me') as { sub: string };
    const user = userRepo.findById(payload.sub);
    if (!user) throw new Error('user gone');
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  } catch {
    throw AppError.unauthorized('Your session expired — sign in again.');
  }
}

export const asyncRoute =
  (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthedRequest, res))
      .catch(next)
      .catch((e) => next(e));
  };

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ ok: true, data });
}

export function requireUser(req: AuthedRequest): { id: string; email: string; name: string } {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const appErr = asAppError(err);
  const logBody = err instanceof Error ? err.message : String(err);
  if (appErr.status >= 500) console.error(`[error] ${logBody}`);
  res.status(appErr.status).json({
    ok: false,
    error: {
      code: appErr.code,
      message: appErr.userMessage,
      suggestion: appErr.suggestion,
    },
  });
}
