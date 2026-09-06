'use client';

import { Check } from 'lucide-react';

export const STEPS = [
  { key: 'ideation', label: 'Idea', desc: 'angles & hooks' },
  { key: 'script', label: 'Script', desc: 'scene breakdown' },
  { key: 'assets', label: 'Assets', desc: 'visuals + voice' },
  { key: 'assembly', label: 'Assembly', desc: 'final video' },
  { key: 'metadata', label: 'Metadata', desc: 'titles & hashtags' },
  { key: 'review', label: 'Review', desc: 'versions & edits' },
  { key: 'publish', label: 'Publish', desc: 'schedule & ship' },
];

export function Stepper({
  states,
  active,
  onSelect,
  allowJump,
}: {
  states: Record<string, string>;
  active: number;
  onSelect: (i: number) => void;
  allowJump: boolean;
}) {
  // count how many leading stages are done (drives the connector fill)
  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex min-w-[720px] items-start">
        {STEPS.map((s, i) => {
          const state = states[s.key] ?? 'not_started';
          const ready = state === 'ready';
          const running = state === 'running';
          const error = state === 'error';
          const clickable = allowJump || ready || i <= active;
          return (
            <li key={s.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div className={`h-0.5 flex-1 rounded ${i === 0 ? 'bg-transparent' : connectorClass(states, i - 1, s.key)}`} />
                <button
                  onClick={() => clickable && onSelect(i)}
                  disabled={!clickable}
                  className={[
                    'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition',
                    ready ? 'border-brand-300 bg-brand-400 text-brand-950'
                    : error ? 'border-rose-400 bg-rose-500/15 text-rose-200'
                    : running ? 'border-brand-300/60 bg-brand-950 text-brand-200 animate-pulseSoft'
                    : active === i ? 'border-brand-300 bg-brand-400/15 text-brand-100'
                    : clickable ? 'border-white/25 bg-white/5 text-brand-100/70 hover:border-brand-300/50'
                    : 'border-white/10 bg-white/[0.02] text-brand-100/30',
                  ].join(' ')}
                >
                  {ready ? <Check size={15} strokeWidth={3} /> : running ? <span className="h-2.5 w-2.5 rounded-full bg-brand-300" /> : i + 1}
                </button>
                <div className={`h-0.5 flex-1 rounded ${connectorClass(states, i, s.key)}`} />
              </div>
              <button
                onClick={() => clickable && onSelect(i)}
                disabled={!clickable}
                className={`mt-2 text-center transition ${active === i ? 'text-white' : clickable ? 'text-brand-100/70 hover:text-white' : 'text-brand-100/30'} ${clickable ? '' : 'cursor-not-allowed'}`}
              >
                <div className="text-[13px] font-semibold leading-tight">{s.label}</div>
                <div className="text-[10px] text-brand-100/50">{s.desc}</div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function connectorClass(states: Record<string, string>, idx: number, nextKey?: string) {
  const key = STEPS[idx]?.key;
  if (!key) return 'bg-transparent';
  const prev = states[key];
  if (prev === 'ready') return 'bg-brand-400/70';
  if (prev === 'running') return 'bg-brand-400/40';
  if (nextKey) {
    const next = states[nextKey];
    if (next === 'error') return 'bg-rose-400/50';
  }
  return 'bg-white/10';
}
