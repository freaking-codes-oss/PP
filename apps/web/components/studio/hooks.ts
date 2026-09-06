'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from '@/lib/api';

export interface StageStatus {
  stage: string;
  state: 'not_started' | 'running' | 'ready' | 'error' | 'blocked';
  progress: number;
  statusText?: string | null;
  updatedAt?: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  idea?: {
    prompt?: string;
    angles?: Array<{ id: string; title: string; hook: string; angle: string; audience?: string; difficulty?: string }>;
    hooks?: Array<{ title: string; note: string }>;
    selectedAngleId?: string | null;
  } | null;
  currentStage: string;
  stageStates: Record<string, string>;
  stylePreset?: {
    id: string; name: string; description: string; swatches: string[]; visualStyle: string;
    captionStyle: string; tone: string; builtIn: boolean;
  } | null;
  videoMode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectApi {
  project: ProjectDetail;
}

const STAGES = ['ideation', 'script', 'assets', 'assembly', 'metadata', 'review', 'publish'];

export const stageIndex = (s: string) => STAGES.indexOf(s);
export const STAGE_ORDER = STAGES;

export function useStageEvents(projectId: string, onEvent: (ev: any) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`/api/v1/projects/${projectId}/events?token=${encodeURIComponent(token)}`);
    es.onmessage = (msg) => {
      try {
        cb.current(JSON.parse(msg.data));
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => { /* EventSource reconnects automatically */ };
    return () => es.close();
  }, [projectId]);
}

export function useProjectData(projectId: string) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<ProjectApi>(`/projects/${projectId}`);
      setDetail(data.project);
      const states = Object.values(data.project.stageStates ?? {});
      setRunning(states.includes('running'));
      setError(null);
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useStageEvents(projectId, (ev) => {
    if (ev.type === 'stage') refresh();
  });

  // lightweight polling while a stage runs (also covers reconnects)
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => refresh(), 3500);
    return () => clearInterval(t);
  }, [running, refresh]);

  return { detail, error, refresh, running, setRunning };
}

export function useAuthedFile(enabled: boolean, path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (!enabled || !path) return;
    api
      .file(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [enabled, path]);
  return { url, failed };
}

export function assetFileUrl(projectId: string, assetId: string): string {
  return `/projects/${projectId}/assets/${assetId}/file`;
}

/** try/catch wrapper for actions that returns a friendly error object */
export async function runAction<T>(fn: () => Promise<T>): Promise<{ data?: T; error?: { message: string; suggestion?: string } }> {
  try {
    return { data: await fn() };
  } catch (e: any) {
    return { error: { message: e?.message ?? 'Something went wrong.', suggestion: e?.suggestion } };
  }
}
