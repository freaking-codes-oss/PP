import { config } from './config';
import { logger } from './logger';
import { makeId, sleep } from './util';

// ---------------------------------------------------------------------------
// Job queue abstraction.
//
// Production: BullMQ on Redis (set REDIS_URL). Demo/dev without Redis: a small
// in-process FIFO worker with the same semantics (attempts, exponential
// backoff, delays) so everything is testable with zero infrastructure.
// Handlers receive a `ctx` with progress reporting + requeue helpers.
// ---------------------------------------------------------------------------

export type JobType =
  | 'generate-scene-assets'
  | 'assets-verify'
  | 'generate-project-music'
  | 'assemble-video'
  | 'generate-metadata'
  | 'publish'
  | 'pipeline-run'
  | 'trends-scan'
  | 'analytics-sync';

export interface JobContext {
  type: JobType;
  data: Record<string, unknown>;
  attempt: number;
  progress(percent: number, text?: string): void;
  log(message: string): void;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

export interface QueueAdapter {
  enqueue(type: JobType, data: Record<string, unknown>, opts?: { delayMs?: number; jobId?: string }): Promise<string>;
  start(handlers: Record<JobType, JobHandler>): Promise<void>;
  close(): Promise<void>;
  onPermanentFail?: (jobId: string, type: JobType, data: Record<string, unknown>, error: string) => void;
  onProgress?: (jobId: string, type: JobType, data: Record<string, unknown>, percent: number, text: string) => void;
}

// ================= in-process implementation =================

interface LocalJob {
  id: string;
  type: JobType;
  data: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  delayUntil: number;
  runAt: number;
}

class LocalQueue implements QueueAdapter {
  private queue: LocalJob[] = [];
  private handlers: Record<JobType, JobHandler> | null = null;
  private running = false;
  private active = 0;
  private stopping = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  async enqueue(type: JobType, data: Record<string, unknown>, opts?: { delayMs?: number }): Promise<string> {
    const id = makeId('job');
    const job: LocalJob = {
      id, type, data,
      attempts: 0,
      maxAttempts: Number(data.maxAttempts) || 3,
      delayUntil: Date.now() + (opts?.delayMs ?? 0),
      runAt: Date.now() + (opts?.delayMs ?? 0),
    };
    this.queue.push(job);
    this.scheduleDrain();
    return id;
  }

  async start(handlers: Record<JobType, JobHandler>): Promise<void> {
    this.handlers = handlers;
    logger.info('In-process job queue started (no REDIS_URL — set one for BullMQ).');
    this.running = true;
    this.drain();
  }

  private scheduleDrain(): void {
    if (!this.running) return;
    const t = setTimeout(() => this.drain(), 50);
    this.timers.add(t);
  }

  private async drain(): Promise<void> {
    if (!this.handlers || this.active >= 1) return; // concurrency 1 keeps stage order predictable
    const now = Date.now();
    const idx = this.queue.findIndex((job) => job.delayUntil <= now);
    if (idx === -1) return this.scheduleDrain();
    const job = this.queue[idx];
    if (job.runAt > now) {
      const wait = job.runAt - now;
      const t = setTimeout(() => this.drain(), Math.min(wait, 2000));
      this.timers.add(t);
      return;
    }
    this.queue.splice(idx, 1);
    this.active++;
    const handler = this.handlers[job.type];
    if (!handler) {
      logger.error(`No handler for job type ${job.type}`);
      this.active--;
      return;
    }
    job.attempts++;
    const ctx: JobContext = {
      type: job.type,
      data: job.data,
      attempt: job.attempts,
      progress: (p, t) => this.onProgress?.(job.id, job.type, job.data, p, t ?? ''),
      log: (m) => logger.info(`[job ${job.id} ${job.type}] ${m}`),
    };
    try {
      await handler(ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (job.attempts < job.maxAttempts) {
        const backoffMs = Math.min(30_000, 1000 * 2 ** (job.attempts - 1)) * (Number(job.data.backoffFactor) || 1);
        job.attempts = job.attempts; // keep count
        job.delayUntil = Date.now() + backoffMs;
        this.queue.push(job);
        logger.warn(`[job ${job.id} ${job.type}] failed (attempt ${job.attempts}/${job.maxAttempts}) — retrying in ${backoffMs}ms: ${msg}`);
      } else {
        logger.error(`[job ${job.id} ${job.type}] failed permanently after ${job.attempts} attempts: ${msg}`);
        this.onPermanentFail?.(job.id, job.type, job.data, msg);
      }
    } finally {
      this.active--;
      this.scheduleDrain();
    }
  }

  onPermanentFail?: (jobId: string, type: JobType, data: Record<string, unknown>, error: string) => void;
  onSuccess?: (jobId: string, type: JobType, data: Record<string, unknown>) => void;
  onProgress?: (jobId: string, type: JobType, data: Record<string, unknown>, percent: number, text: string) => void;

  async close(): Promise<void> {
    this.stopping = true;
    this.timers.forEach((t) => clearTimeout(t));
  }
}

// ================= BullMQ implementation =================

class BullQueue implements QueueAdapter {
  private queue: any = null;
  private worker: any = null;
  private handlers: Record<JobType, JobHandler> | null = null;

  async enqueue(type: JobType, data: Record<string, unknown>, opts?: { delayMs?: number }): Promise<string> {
    const { Queue } = await import('bullmq');
    const queue = this.queue ?? (this.queue = new Queue('cas', { connection: { url: config.REDIS_URL } }));
    const job = await queue.add(type, data, {
      attempts: Number(data.maxAttempts) || 3,
      backoff: { type: 'exponential', delay: Number(data.backoffFactor) || 1000 },
      removeOnComplete: 200,
      removeOnFail: 500,
      delay: opts?.delayMs ?? 0,
    });
    return job.id as string;
  }

  async start(handlers: Record<JobType, JobHandler>): Promise<void> {
    const { Worker } = await import('bullmq');
    this.handlers = handlers;
    this.worker = new Worker(
      'cas',
      async (job: any) => {
        const handler = this.handlers![job.name as JobType];
        if (!handler) throw new Error(`No handler for ${job.name}`);
        const ctx: JobContext = {
          type: job.name as JobType,
          data: job.data,
          attempt: job.attemptsMade + 1,
          progress: (p, t) => job.updateProgress({ p, t }),
          log: (m) => logger.info(`[bull ${job.id} ${job.name}] ${m}`),
        };
        await handler(ctx);
      },
      { connection: { url: config.REDIS_URL }, concurrency: 2 },
    );
    logger.info('BullMQ worker started on Redis.');
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}

let adapter: QueueAdapter | undefined;

export function queue(): QueueAdapter {
  if (!adapter) adapter = config.REDIS_URL ? new BullQueue() : new LocalQueue();
  return adapter;
}

export async function waitForIdleLocal(): Promise<void> {
  await sleep(300);
}
