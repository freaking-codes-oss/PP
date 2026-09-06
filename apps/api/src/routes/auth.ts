import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { userRepo } from '../db/repos';
import { makeId, nowIso } from '../util';
import { AppError } from '../errors';
import { config } from '../config';
import { asyncRoute, ok, signToken, requireUser, authMiddleware } from './helpers';

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters.'),
  name: z.string().min(1).max(80),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(u: { id: string; email: string; name: string; created_at: string }) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at };
}

router.post(
  '/signup',
  asyncRoute(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Check the form fields.';
      throw AppError.badRequest(msg);
    }
    const { email, password, name } = parsed.data;
    if (userRepo.findByEmail(email.toLowerCase())) {
      throw AppError.conflict('An account with that email already exists — sign in instead.');
    }
    const id = makeId('usr');
    const hash = await bcrypt.hash(password, 10);
    userRepo.create({ id, email: email.toLowerCase(), password_hash: hash, name: name.trim() });
    const user = userRepo.findById(id)!;
    ok(res, { token: signToken(user.id), user: publicUser(user) }, 201);
  }),
);

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw AppError.badRequest('Enter your email and password.');
    const user = userRepo.findByEmail(parsed.data.email.toLowerCase());
    const valid = user ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
    if (!user || !valid) throw AppError.unauthorized('That email/password combination did not work.');
    ok(res, { token: signToken(user.id), user: publicUser(user) });
  }),
);

// One-click demo account (dev convenience; disabled via CAS_ALLOW_DEMO_AUTH=false)
router.post(
  '/demo',
  asyncRoute(async (_req, res) => {
    if (!config.demoMode) throw AppError.unauthorized('Demo access is disabled on this deployment.');
    const email = 'demo@cas.dev';
    let user = userRepo.findByEmail(email);
    if (!user) {
      const id = makeId('usr');
      const hash = await bcrypt.hash(Math.random().toString(36), 4);
      userRepo.create({ id, email, password_hash: hash, name: 'Demo Creator' });
      user = userRepo.findById(id)!;
    }
    ok(res, { token: signToken(user.id), user: publicUser(user) });
  }),
);

router.get(
  '/me',
  authMiddleware,
  asyncRoute(async (req, res) => {
    const u = requireUser(req);
    const full = userRepo.findById(u.id)!;
    ok(res, { user: publicUser(full) });
  }),
);

export default router;
