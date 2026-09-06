// Stage/project helpers used by routes and workers to persist + broadcast
// pipeline progress in one place.
import { PipelineStage } from '@cas/shared';
import { stageRepo } from './db/repos';
import { bus } from './events';

export function setStage(
  projectId: string,
  stage: PipelineStage | string,
  state: 'not_started' | 'running' | 'ready' | 'error' | 'blocked',
  extra: { progress?: number; statusText?: string; userId?: string } = {},
): void {
  const stageKey = stage as PipelineStage;
  const progress =
    extra.progress ??
    (state === 'ready' ? 100 : state === 'running' ? 1 : state === 'error' ? 0 : 0);
  stageRepo.upsert(projectId, stageKey, { state, progress, status_text: extra.statusText });
  if (extra.userId) {
    bus.stage(extra.userId, {
      projectId,
      stage: stageKey,
      state,
      progress,
      statusText: extra.statusText,
    });
  }
}

export function setStageRunning(projectId: string, stage: PipelineStage | string, statusText?: string, userId?: string): void {
  setStage(projectId, stage, 'running', { statusText, userId });
}
export function setStageReady(projectId: string, stage: PipelineStage | string, statusText?: string, userId?: string): void {
  setStage(projectId, stage, 'ready', { statusText, userId });
}
export function setStageError(projectId: string, stage: PipelineStage | string, statusText: string, userId?: string): void {
  setStage(projectId, stage, 'error', { statusText, userId });
}
