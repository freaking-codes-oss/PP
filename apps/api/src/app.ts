import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import projectRouter from './routes/projects';
import platformRouter from './routes/platform';
import { authMiddleware, errorMiddleware } from './routes/helpers';

export function createApp() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true, service: 'content-automation-studio-api', time: new Date().toISOString() });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/projects', authMiddleware, projectRouter);
  app.use('/api/v1', authMiddleware, platformRouter);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
  });
  app.use(errorMiddleware);
  return app;
}
