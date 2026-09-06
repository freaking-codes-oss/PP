'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw, Save, Sparkles, TrendingUp, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { ProjectDetail } from './hooks';
import { Scene, StudioData } from './types';
import { Badge, Button, FriendlyError, ProgressBar } from '@/components/ui';
import { runAction } from './hooks';

// ---------------------------------------------------------------------------
// STAGE 1 — IDEATION
// ---------------------------------------------------------------------------

interface TrendRow {
  id: string;
  title: string;
  source: string;
  category: string | null;
  region: string | null;
}

export function IdeationPanel({
  project,
  refresh,
  stylePresets = [],
  onApplyStyle,
}: {
  project: ProjectDetail;
  refresh: () => Promise<void>;
  stylePresets?: Array<{ id: string; name: string; description: string; swatches: string[]; tone: string }>;
  onApplyStyle?: (id: string) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(project.idea?.prompt ?? '');
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  useEffect(() => {
    api
      .get<{ trends: TrendRow[] }>('/trends?limit=16')
      .then((d) => setTrends(d.trends))
      .catch(() => undefined);
  }, []);

  const idea = project.idea;
  const angles = idea?.angles ?? [];
  const hooks = idea?.hooks ?? [];

  async function generate() {
    setBusy(true);
    setError(null);
    const { error: err } = await runAction(() =>
      api.post(`/projects/${project.id}/ideation`, { prompt, trendIds: picked }),
    );
    if (err) setError(err);
    await refresh();
    setBusy(false);
  }

  async function selectAngle(angleId: string) {
    const { error: err } = await runAction(() => api.post(`/projects/${project.id}/ideation/select-angle`, { angleId }));
    if (err) setError(err);
    await refresh();
  }

  const currentStyle = stylePresets.find((s) => s.id === (project as any).stylePreset?.id);

  return (
    <div className="space-y-5">
      <div className="card card-pad space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Sparkles size={18} className="text-brand-300" /> Stage 1 — Ideas & hooks</h2>
            <p className="text-sm text-brand-100/55">The AI expands your topic into several short-form angles you can pick from.</p>
          </div>
          {angles.length > 0 && (
            <Button variant="primary" onClick={generate} loading={busy}>
              <RefreshCw size={15} /> New angles
            </Button>
          )}
        </div>
        <textarea
          className="input min-h-[70px] resize-y text-base"
          placeholder="e.g. how to batch a week of content in one hour"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {trends.length > 0 && (
          <div>
            <div className="label">Pull in trending topics as “why now” context (optional)</div>
            <div className="flex flex-wrap gap-1.5">
              {trends.slice(0, 12).map((t) => {
                const on = picked.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                    className={`chip transition ${on ? 'border-amber-300/50 bg-amber-300/10 text-amber-100' : 'hover:border-white/25'}`}
                  >
                    <TrendingUp size={11} className={on ? 'text-amber-300' : ''} /> {t.title.length > 52 ? t.title.slice(0, 52) + '…' : t.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {angles.length === 0 && (
          <Button variant="primary" onClick={generate} loading={busy}>
            <Wand2 size={15} /> Expand into angles
          </Button>
        )}
        {error && <FriendlyError error={error} />}

        {stylePresets.length > 0 && (
          <div>
            <div className="label">Style preset — visual style, palette, captions & tone get appended to every generation prompt</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {stylePresets.map((sp) => {
                const active = (project as any).stylePreset?.id === sp.id;
                return (
                  <button
                    key={sp.id}
                    onClick={() => onApplyStyle?.(sp.id)}
                    className={`rounded-xl border p-2.5 text-left transition ${active ? 'border-brand-300/70 bg-brand-400/10 ring-1 ring-brand-300/30' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
                  >
                    <div className="mb-2 flex gap-1">
                      {sp.swatches.slice(0, 4).map((c) => (
                        <span key={c} className="h-4 flex-1 rounded-full" style={{ background: c }} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-xs font-bold text-white">{sp.name}</span>
                      {active && <Check size={12} className="shrink-0 text-brand-300" />}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-brand-100/50">{sp.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {hooks.length > 0 && (
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-amber-200/80">Trend context applied</div>
          <ul className="space-y-1 text-sm text-amber-100/80">
            {hooks.map((h, i) => (
              <li key={i}>• {h.title} — <span className="text-amber-100/55">{h.note}</span></li>
            ))}
          </ul>
        </div>
      )}

      {angles.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {angles.map((a, i) => {
            const selected = idea?.selectedAngleId === a.id;
            return (
              <button
                key={a.id}
                onClick={() => !selected && selectAngle(a.id)}
                className={`card card-pad text-left transition ${selected ? 'border-brand-300/70 bg-brand-400/[0.12] ring-1 ring-brand-300/40' : 'hover:border-white/20'}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-bold text-brand-100/80">ANGLE {i + 1}</span>
                  {selected ? (
                    <Badge tone="ok"><Check size={11} /> selected</Badge>
                  ) : (
                    <Badge>tap to use</Badge>
                  )}
                </div>
                <h3 className="mb-1.5 font-semibold leading-snug text-white">{a.title}</h3>
                <p className="mb-2 text-sm text-brand-100/70">“{a.hook}”</p>
                <p className="text-[13px] text-brand-100/50">{a.angle}</p>
                <div className="mt-3 flex gap-1.5">
                  <span className="chip">{a.audience ?? 'general'}</span>
                  <span className="chip capitalize">{a.difficulty ?? 'medium'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 2 — SCRIPT / SCENE BREAKDOWN
// ---------------------------------------------------------------------------

export function ScriptPanel({ project, script, refresh }: { project: ProjectDetail; script: StudioData['script']; refresh: () => Promise<void> }) {
  const latest = script?.latest;
  const [draft, setDraft] = useState<Scene[] | null>(null);
  const [sceneCount, setSceneCount] = useState(6);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const scenes = useMemo(() => draft ?? latest?.scenes ?? [], [draft, latest?.scenes]);
  useEffect(() => setDraft(null), [latest?.version, latest?.id]);

  async function generate() {
    setBusy('Writing your scene breakdown…');
    setError(null);
    const { error: err } = await runAction(() => api.post(`/projects/${project.id}/script`, { sceneCount }));
    if (err) setError(err);
    await refresh();
    setDraft(null);
    setBusy(null);
  }

  async function saveEdits() {
    setBusy('Saving your edits…');
    setError(null);
    const latestParsed = latest;
    const { error: err } = await runAction(() =>
      api.put(`/projects/${project.id}/script/scenes`, {
        title: latestParsed?.title ?? '',
        overview: latestParsed?.overview ?? '',
        scenes: scenes.map((s) => ({
          id: s.id,
          visual_description: s.visual_description,
          voiceover: s.voiceover,
          on_screen_text: s.on_screen_text,
          duration_sec: Math.min(12, Math.max(2, Number(s.duration_sec) || 4)),
        })),
      }),
    );
    if (err) setError(err);
    await refresh();
    setDraft(null);
    setBusy(null);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  const totalSec = scenes.reduce((s, x) => s + (Number(x.duration_sec) || 0), 0);

  return (
    <div className="space-y-5">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Stage 2 — Script & scenes</h2>
          <p className="text-sm text-brand-100/55">A structured breakdown: what we see, what we say, what’s on screen. Edit anything inline — your changes are kept as a new version.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-brand-100/60">
            <span className="label mb-0">Scenes</span>
            <select className="input w-auto py-1.5" value={sceneCount} onChange={(e) => setSceneCount(Number(e.target.value))} disabled={busy !== null}>
              {[5, 6, 7].map((n) => <option key={n} value={n}>{n} scenes</option>)}
            </select>
          </div>
          <Button variant="primary" onClick={generate} loading={busy !== null}>
            <Wand2 size={15} /> Generate script
          </Button>
        </div>
      </div>
      {error && <FriendlyError error={error} />}

      {latest && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-brand-100/60">
          <Badge tone="brand">version {latest.version}</Badge>
          <Badge>{latest.source === 'manual-edit' ? 'your edit' : 'AI-generated'}</Badge>
          <span className="ml-auto">~{Math.round(totalSec)}s total · {scenes.length} scenes</span>
        </div>
      )}

      {scenes.length > 0 && (
        <div className="space-y-3">
          {scenes.map((sc, i) => (
            <div key={sc.id} className="card card-pad grid gap-3 md:grid-cols-[220px_1fr]">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="rounded-md bg-brand-400/15 px-2 py-0.5 text-xs font-bold text-brand-200">SCENE {i + 1}</span>
                  <div className="flex items-center gap-1 text-[11px] text-brand-100/50">
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={Number(sc.duration_sec) || 4}
                      onChange={(e) => setDraft(scenes.map((s) => (s.id === sc.id ? { ...s, duration_sec: Number(e.target.value) } : s)))}
                      className="w-12 rounded-md border border-white/10 bg-brand-950/60 px-1.5 py-1 text-center text-xs text-brand-50 outline-none"
                    />
                    sec
                  </div>
                </div>
                <label className="label">What we see</label>
                <textarea
                  className="input min-h-[92px] resize-y text-[13px] leading-relaxed"
                  value={sc.visual_description}
                  onChange={(e) => setDraft(scenes.map((s) => (s.id === sc.id ? { ...s, visual_description: e.target.value } : s)))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Voiceover 🎙</label>
                  <textarea
                    className="input min-h-[128px] resize-y text-[13px] leading-relaxed"
                    value={sc.voiceover}
                    onChange={(e) => setDraft(scenes.map((s) => (s.id === sc.id ? { ...s, voiceover: e.target.value } : s)))}
                  />
                </div>
                <div>
                  <label className="label">On-screen text</label>
                  <input
                    className="input text-[13px]"
                    value={sc.on_screen_text}
                    onChange={(e) => setDraft(scenes.map((s) => (s.id === sc.id ? { ...s, on_screen_text: e.target.value } : s)))}
                  />
                  <div className="mt-3 rounded-lg border border-brand-300/20 bg-brand-950/50 p-3 text-center">
                    <div className="text-sm font-bold uppercase tracking-wide text-white">{sc.on_screen_text || 'caption preview'}</div>
                    <div className="mt-1 h-1 w-24 rounded-full bg-brand-300/70" style={{ margin: '6px auto 0' }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-brand-100/45">Tip: durations between 4–7s keep retention healthy for Shorts & Reels.</span>
            <div className="flex gap-2">
              {draft && <Button onClick={() => setDraft(null)}>Discard edits</Button>}
              <Button variant="primary" onClick={saveEdits} loading={busy !== null} disabled={!draft}>
                {savedFlash ? <><Check size={15} /> Saved as v{(latest?.version ?? 0) + 1}</> : <><Save size={15} /> Save edits as version</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {script && script.versions.length > 1 && (
        <div className="card card-pad">
          <div className="label">Version history</div>
          <div className="flex flex-wrap gap-2">
            {script.versions.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setDraft(v.scenes);
                  setError(null);
                }}
                className={`chip ${v.version === latest?.version ? 'border-brand-300/50 bg-brand-400/15 text-brand-100' : 'hover:border-white/30'}`}
                title="Load this version into the editor, then save to switch back"
              >
                v{v.version} · {v.source === 'manual-edit' ? 'your edit' : 'AI'} · {v.createdAt.slice(0, 10)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-brand-100/40">Loading an older version into the editor and saving creates a new version — nothing is destroyed.</p>
        </div>
      )}
    </div>
  );
}
