import { EventEmitter } from 'node:events';

// In-process event bus used to push stage/job progress to the UI over SSE.
// (Swap for Redis pub/sub when running multiple API instances.)

export interface StageEvent {
  projectId: string;
  stage: string;
  state: string;
  progress?: number;
  statusText?: string;
  at: string;
}

class Bus extends EventEmitter {
  stage(userId: string, ev: Omit<StageEvent, 'at'>) {
    this.emit('stage', userId, { ...ev, at: new Date().toISOString() });
  }
  broadcast(userId: string, channel: string, payload: unknown) {
    this.emit(channel, userId, payload);
  }
}

export const bus = new Bus();
bus.setMaxListeners(0);

export const subscribe = (userId: string, handler: (ev: StageEvent) => void) => {
  const onStage = (u: string, ev: StageEvent) => {
    if (u === userId) handler(ev);
  };
  bus.on('stage', onStage);
  return () => bus.off('stage', onStage);
};
