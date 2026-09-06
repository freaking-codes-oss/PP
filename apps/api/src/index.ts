import { PipelineStage } from '@cas/shared';
import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { initDb } from './db/db';
import { seedIfEmpty } from './db/seed';
import { providerConfigRepo } from './providers/configRepo';
import { queue } from './queue';
import { handlers } from './workers';
import { userRepo } from './db/repos';
import { setStage, setStageError } from './stage';

async function boot() {
  await initDb();
  providerConfigRepo.syncRegistry();
  seedIfEmpty();

  const q = queue();

  // Keep stage rows honest when a queued job fails permanently or reports
  // progress (in-process adapter → DB + SSE; BullMQ mirrors via job progress).
  const STAGE_BY_JOB: Record<string, PipelineStage | undefined> = {
    'generate-scene-assets': PipelineStage.ASSETS,
    'assets-verify': PipelineStage.ASSETS,
    'generate-project-music': PipelineStage.ASSETS,
    'assemble-video': PipelineStage.ASSEMBLY,
    'generate-metadata': PipelineStage.METADATA,
    'publish': PipelineStage.PUBLISH,
  };
  q.onPermanentFail = (_jobId, type, data, errorMsg) => {
    const stage = STAGE_BY_JOB[type];
    const pid = data.projectId ? String(data.projectId) : undefined;
    const userId = typeof data.userId === 'string' ? data.userId : undefined;
    if (stage && pid) {
      setStageError(pid, stage, errorMsg.slice(0, 400), userId);
    } else {
      logger.error(`[job ${type}] failed permanently: ${errorMsg.slice(0, 400)}`);
    }
  };
  q.onProgress = (_jobId, type, data, percent, text) => {
    const stage = STAGE_BY_JOB[type];
    const pid = data.projectId ? String(data.projectId) : undefined;
    const userId = typeof data.userId === 'string' ? data.userId : undefined;
    if (stage && pid) setStage(pid, stage, 'running', { progress: percent, statusText: text, userId });
  };

  await q.start(handlers as any);
  logger.info('Job queue ready.');

  const app = createApp();
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info(`Content Automation Studio API listening on http://0.0.0.0:${config.PORT}`);
  });

  // daily demo maintenance (best-effort): keep demo analytics moving so the
  // dashboard is never stale
  const daily = setInterval(async () => {
    try {
      const demo = userRepo.findByEmail('demo@cas.dev');
      if (demo) {
        const { syncAnalyticsForUser } = await import('./lib/analytics');
        await syncAnalyticsForUser(demo.id);
      }
    } catch (e) {
      logger.warn('daily demo sync failed', e);
    }
  }, 6 * 60 * 60 * 1000); // every 6h is fine for a demo
  daily.unref?.();

  const shutdown = async () => {
    logger.info('Shutting down…');
    clearInterval(daily);
    server.close();
    await queue().close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

boot().catch((e) => {
  console.error('Failed to boot API:', e);
  process.exit(1);
});
