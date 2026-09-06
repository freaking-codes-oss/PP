'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AudioLines, Check, Copy, Download, Film, Image as ImageIcon, Music2, Pencil, Play, RefreshCw,
  Rocket, Send, Sparkles, Undo2, Wand2, Youtube,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ProjectDetail } from './hooks';
import { assetFileUrl, runAction, useAuthedFile } from './hooks';
import type { AssetInfo, MetadataRow, PublishJobInfo, Scene, StudioData, StylePresetInfo } from './types';
import { Badge, Button, EmptyState, FriendlyError, ProgressBar, Skeleton } from '@/components/ui';
import { BrandIcon } from '@/components/icons';
import { brandColor } from '@/components/icons';

const sceneOf = (assets: AssetInfo[], sceneId: string | undefined, type: string) =>
  assets.find((a) => a.sceneId === sceneId && a.type === type);

// ---------------------------------------------------------------------------
// STAGE 3 — ASSETS
// ---------------------------------------------------------------------------

export function AssetsPanel({
  project,
  script,
  assets,
  stylePreset,
  refresh,
}: {
  project: ProjectDetail;
  script: StudioData['script'];
  assets: AssetInfo[];
  stylePreset?: StylePresetInfo | null;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const scenes = script?.latest?.scenes ?? [];
  const totalReady = assets.filter((a) => a.status === 'ready').length;

  async function doAction(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    const { error: err } = await runAction(fn);
    if (err) setError(err);
    await refresh();
    setBusy(null);
  }

  async function revert(asset: AssetInfo, versionId: string) {
    await doAction(`rev:${asset.id}`, () => api.post(`/projects/${project.id}/versions/${asset.id}/revert`, { versionId }));
  }

  return (
    <div className="space-y-5">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Stage 3 — Scene assets</h2>
          <p className="max-w-2xl text-sm text-brand-100/55">
            One visual + one voiceover per scene, generated through the AI provider router (any failing provider is skipped automatically).
            Demo visuals are stylish placeholders; add a provider key in Settings → AI providers for real image generation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => doAction('genmissing', () => api.post(`/projects/${project.id}/assets/generate`, { regenerate: 'missing' }))} loading={busy === 'genmissing'}>
            <Wand2 size={15} /> Generate missing
          </Button>
          <Button variant="secondary" onClick={() => doAction('genall', () => api.post(`/projects/${project.id}/assets/generate`, { regenerate: 'all' }))} loading={busy === 'genall'} disabled={!scenes.length}>
            <RefreshCw size={15} /> Regenerate all
          </Button>
        </div>
      </div>
      {error && <FriendlyError error={error} />}

      {!script?.latest ? (
        <EmptyState icon={<Film size={26} />} title="No script yet" body="Write the script first — scene assets are generated from it." />
      ) : (
        <>
          <div className="space-y-4">
            {scenes.map((sc: Scene, i) => (
              <SceneAssetCard
                key={sc.id}
                projectId={project.id}
                scene={sc}
                index={i}
                image={sceneOf(assets, sc.id, 'image')}
                audio={sceneOf(assets, sc.id, 'audio')}
                stylePreset={stylePreset}
                busy={busy}
                onAction={doAction}
                onRevert={revert}
              />
            ))}
          </div>
          {musicAsset(assets) && (
            <div className="card card-pad flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-brand-400/15 p-2.5 text-brand-300"><Music2 size={18} /></div>
                <div>
                  <div className="text-sm font-semibold text-white">Background music</div>
                  <div className="text-xs text-brand-100/55">Soft generative pad, mixed under the voiceover by FFmpeg</div>
                </div>
              </div>
              <Button onClick={() => doAction('music', () => api.post(`/projects/${project.id}/assets/${musicAsset(assets)!.id}/regenerate`))} loading={busy === 'music'}>
                <RefreshCw size={14} /> New bed
              </Button>
            </div>
          )}
          <div className="text-right text-xs text-brand-100/45">{totalReady} assets ready · style preset: {stylePreset?.name ?? 'none'}</div>
        </>
      )}
    </div>
  );
}

function musicAsset(assets: AssetInfo[]) {
  return assets.find((a) => a.type === 'music' && !a.sceneId);
}

function SceneAssetCard({
  projectId, scene, index, image, audio, stylePreset, busy, onAction, onRevert,
}: {
  projectId: string;
  scene: Scene;
  index: number;
  image?: AssetInfo;
  audio?: AssetInfo;
  stylePreset?: StylePresetInfo | null;
  busy: string | null;
  onAction: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  onRevert: (asset: AssetInfo, versionId: string) => Promise<void>;
}) {
  const { url: imgUrl } = useAuthedFile(!!image?.currentVersion, image ? assetFileUrl(projectId, image.id) : null);
  const accent = stylePreset?.swatches?.[3] ?? '#7fd8be';
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-brand-400/15 px-2 py-0.5 text-xs font-bold text-brand-200">SCENE {index + 1}</span>
        <span className="text-[11px] text-brand-100/50">{scene.id} · {scene.duration_sec}s</span>
        <span className="ml-auto text-[11px] text-brand-100/45">{scene.on_screen_text}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-[170px_1fr] lg:grid-cols-[170px_1fr_1fr]">
        {/* visual */}
        <div>
          {!image ? (
            <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-brand-100/40">
              <ImageIcon size={20} />
              <span className="text-[11px]">no visual yet</span>
            </div>
          ) : !imgUrl ? (
            <Skeleton className="aspect-[9/16] w-full" />
          ) : (
            <div className="group relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-white/10">
              <img src={imgUrl} alt={`Scene ${index + 1} visual`} className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6">
                <div className="text-center text-[9px] font-bold uppercase tracking-wide text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,.8)' }}>
                  {scene.on_screen_text || ' '}
                </div>
                <div className="mx-auto mt-0.5 h-[3px] w-14 rounded" style={{ background: accent }} />
              </div>
              {image?.currentVersion?.provider === 'mock' && (
                <span className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-brand-100">demo visual</span>
              )}
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <VersionMenu asset={image} onRevert={onRevert} />
            <Button
              size="sm"
              onClick={() => onAction(`img:${scene.id}`, () => api.post(`/projects/${projectId}/assets/${image!.id}/regenerate`))}
              disabled={!image}
              loading={busy === `img:${scene.id}`}
              className="px-2.5 py-1.5 text-xs"
            >
              <RefreshCw size={12} /> Visual
            </Button>
          </div>
        </div>

        {/* voiceover */}
        <div className="rounded-xl border border-white/10 bg-brand-950/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-100/70">
              <AudioLines size={13} className="text-brand-300" /> Voiceover
            </span>
            <Button
              size="sm"
              onClick={() => onAction(`aud:${scene.id}`, () => api.post(`/projects/${projectId}/assets/${audio!.id}/regenerate`))}
              disabled={!audio}
              loading={busy === `aud:${scene.id}`}
              className="px-2.5 py-1.5 text-xs"
            >
              <RefreshCw size={12} /> Voice
            </Button>
          </div>
          <p className="mb-2 text-[13px] italic leading-relaxed text-brand-100/80">“{scene.voiceover}”</p>
          {audio?.currentVersion && (
            <div className="flex items-center gap-2 text-[11px] text-brand-100/45">
              {audio.currentVersion.provider === 'mock-tts-espeak' ? 'local TTS (eSpeak-NG)' : audio.currentVersion.provider}
              {audio.currentVersion.durationSec != null && <> · {audio.currentVersion.durationSec.toFixed(1)}s</>}
              {audio.versions.length > 1 && <span className="ml-auto">v{audio.versions.length}</span>}
            </div>
          )}
        </div>

        {/* scene summary */}
        <div className="hidden flex-col justify-between rounded-xl border border-white/10 bg-brand-950/40 p-3 lg:flex">
          <div>
            <div className="label mb-1">Visual direction</div>
            <p className="text-[12px] leading-relaxed text-brand-100/70">{scene.visual_description}</p>
          </div>
          <button
            onClick={() => onAction(`aud2:${scene.id}`, () => api.post(`/projects/${projectId}/assets/${audio!.id}/regenerate`))}
            className="hidden"
          >
            unused
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionMenu({ asset, onRevert }: { asset?: AssetInfo; onRevert: (a: AssetInfo, v: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!asset || asset.versions.length <= 1) {
    return <span className="text-[10px] text-brand-100/35">v{asset?.versionCount ?? 0 ? 1 : 0}</span>;
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-brand-100/70 hover:bg-white/10">
        <Undo2 size={10} /> v{asset.currentVersion?.version ?? asset.versionCount}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 w-44 rounded-xl border border-white/10 bg-brand-900 p-1.5 shadow-2xl">
            {asset.versions.map((v) => (
              <button
                key={v.id}
                onClick={async () => { setOpen(false); await onRevert(asset, v.id); }}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-white/10 ${v.id === asset.currentVersion?.id ? 'text-brand-200' : 'text-brand-100/70'}`}
              >
                <span>version {v.version}</span>
                {v.id === asset.currentVersion?.id && <Check size={11} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 4 — ASSEMBLY
// ---------------------------------------------------------------------------

export function AssemblyPanel({
  project, assets, stageStates, refresh,
}: {
  project: ProjectDetail;
  assets: AssetInfo[];
  stageStates: Record<string, string>;
  refresh: () => Promise<void>;
}) {
  const composite = assets.find((a) => a.type === 'composite' && !a.sceneId);
  const { url: videoUrl } = useAuthedFile(!!composite?.currentVersion, composite ? assetFileUrl(project.id, composite.id) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const stage = stageStates.assembly;
  const running = stage === 'running';

  async function assemble() {
    setBusy(true);
    setError(null);
    const { error: err } = await runAction(() => api.post(`/projects/${project.id}/assemble`));
    if (err) setError(err);
    await refresh();
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Stage 4 — Assembly</h2>
          <p className="max-w-2xl text-sm text-brand-100/55">
            Scenes are stitched with FFmpeg: Ken Burns motion on each visual, captions burned in with your style preset,
            voiceover placed on the timeline and a music bed mixed underneath. True AI-video providers are routed to when available;
            the slideshow path is the reliability backbone and always works.
          </p>
        </div>
        <Button variant="primary" onClick={assemble} loading={busy || running} disabled={!assets.some((a) => a.sceneId && a.type === 'image' && a.currentVersion)}>
          <Film size={15} /> {composite?.currentVersion ? 'Assemble a new cut' : 'Assemble video'}
        </Button>
      </div>
      {error && <FriendlyError error={error} />}
      {running && (
        <div className="card card-pad space-y-2">
          <div className="text-sm font-medium text-brand-100">Encoding your video — this can take a minute…</div>
          <ProgressBar value={0} color="bg-brand-300" />
        </div>
      )}
      {composite?.currentVersion ? (
        <div className="card overflow-hidden">
          <div className="flex aspect-[9/16] max-h-[70vh] w-full items-center justify-center bg-black/60 sm:mx-auto sm:max-w-[380px]">
            {videoUrl ? (
              <video src={videoUrl} controls playsInline className="h-full w-full" />
            ) : (
              <div className="flex flex-col items-center gap-2 p-8 text-brand-100/50">
                <Skeleton className="h-full w-full" />
                <span className="text-xs">preparing preview…</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
            <div className="flex flex-wrap gap-2 text-xs text-brand-100/60">
              <Badge tone="ok">ready</Badge>
              <span>v{composite.currentVersion.version}</span>
              {composite.currentVersion.durationSec != null && <span>~{Math.round(composite.currentVersion.durationSec)}s</span>}
              <span>720×1280 · H.264</span>
              <span>captions · music bed</span>
            </div>
            {videoUrl && (
              <a className="btn-secondary px-3 py-1.5 text-xs" href={videoUrl} download={`${slug(project.name)}.mp4`}>
                <Download size={13} /> Download
              </a>
            )}
          </div>
        </div>
      ) : (
        !running && (
          <EmptyState
            icon={<Film size={26} />}
            title="Nothing assembled yet"
            body="Once every scene has a visual and a voiceover, hit Assemble video — FFmpeg does the rest."
          />
        )
      )}
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cas-video';
}

// ---------------------------------------------------------------------------
// STAGE 5 — METADATA
// ---------------------------------------------------------------------------

const PLATFORM_LABEL: Record<string, string> = {
  youtube: 'YouTube · Shorts', tiktok: 'TikTok', instagram: 'Instagram · Reels', facebook: 'Facebook · Reels',
};

export function MetadataPanel({
  project, metadata, refresh, stageStates,
}: {
  project: ProjectDetail;
  metadata: MetadataRow[];
  refresh: () => Promise<void>;
  stageStates: Record<string, string>;
}) {
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const platforms = ['youtube', 'tiktok', 'instagram', 'facebook'];
  const running = stageStates.metadata === 'running';

  async function generate(platform?: string) {
    setBusyPlatform(platform ?? 'all');
    setError(null);
    const body = platform ? { platforms: [platform] } : undefined;
    const { error: err } = await runAction(() => api.post(`/projects/${project.id}/metadata`, body));
    if (err) setError(err);
    await refresh();
    setBusyPlatform(null);
  }

  async function copy(row: MetadataRow, field: string, value: string) {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setCopied(`${row.platform}:${field}`);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-5">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Stage 5 — Metadata per platform</h2>
          <p className="max-w-2xl text-sm text-brand-100/55">
            Titles, descriptions, hashtags and thumbnail concepts, adapted to each platform’s format rules (aspect ratio, caption limits).
          </p>
        </div>
        <Button variant="primary" onClick={() => generate()} loading={busyPlatform === 'all' || running} disabled={metadata.length >= 4 && !running}>
          {metadata.length >= 4 && !running ? (<><RefreshCw size={15} /> Regenerate all</>) : (<><Wand2 size={15} /> Generate metadata</>)}
        </Button>
      </div>
      {error && <FriendlyError error={error} />}

      {metadata.length === 0 && !running ? (
        <EmptyState icon={<Sparkles size={26} />} title="No metadata yet" body="After assembly, generate titles & hashtags for every platform." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {metadata.map((row) => (
            <div key={row.platform} className="card card-pad space-y-3">
              <div className="flex items-center gap-2">
                <BrandIcon platform={row.platform} size={22} />
                <h3 className="font-semibold text-white">{PLATFORM_LABEL[row.platform] ?? row.platform}</h3>
                <span className="ml-auto text-[10px] text-brand-100/40">v{row.version}</span>
                <Button size="sm" className="px-2 py-1 text-[11px]" onClick={() => generate(row.platform)} loading={busyPlatform === row.platform}>
                  <RefreshCw size={11} /> redo
                </Button>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="label mb-0">Title</label>
                  <button onClick={() => copy(row, 'title', row.title)} className="text-brand-100/40 hover:text-brand-100"><Copy size={12} /></button>
                </div>
                <div className="rounded-lg border border-white/10 bg-brand-950/40 px-3 py-2 text-sm font-semibold text-white">
                  {row.title}
                  {copied === `${row.platform}:title` && <span className="ml-2 text-[10px] text-brand-300">copied</span>}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="label mb-0">Description</label>
                  <button onClick={() => copy(row, 'desc', row.description)} className="text-brand-100/40 hover:text-brand-100"><Copy size={12} /></button>
                </div>
                <p className="whitespace-pre-wrap rounded-lg border border-white/10 bg-brand-950/40 px-3 py-2 text-[13px] leading-relaxed text-brand-100/75">{row.description}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.hashtags.map((h) => <span key={h} className="chip text-[11px]">{h}</span>)}
              </div>
              <div>
                <div className="label">Thumbnail concepts</div>
                <ul className="space-y-1.5">
                  {row.thumbnailConcepts.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-brand-100/65">
                      <span className="mt-0.5" style={{ color: brandColor(row.platform) }}>◆</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
          {platforms.filter((p) => !metadata.find((m) => m.platform === p)).map((p) => (
            <button key={p} onClick={() => generate(p)} className="card flex min-h-[120px] flex-col items-center justify-center gap-2 border-dashed text-brand-100/40 transition hover:border-brand-300/40 hover:text-brand-200">
              <BrandIcon platform={p} size={26} />
              <span className="text-sm font-medium">{PLATFORM_LABEL[p]}</span>
              <span className="text-xs">not generated yet — tap to create</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STAGE 6 — REVIEW
// ---------------------------------------------------------------------------

export function ReviewPanel({ data, goTo }: { data: StudioData; goTo: (i: number) => void }) {
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const scenes = data.script?.latest?.scenes ?? [];
  const byScene = scenes.map((sc) => {
    const img = data.assets.find((a) => a.sceneId === sc.id && a.type === 'image');
    const aud = data.assets.find((a) => a.sceneId === sc.id && a.type === 'audio');
    return { scene: sc, img, aud };
  });
  const composite = data.assets.find((a) => a.type === 'composite');
  const allReady = byScene.every((b) => b.img?.currentVersion && b.aud?.currentVersion);

  return (
    <div className="space-y-5">
      <div className="card card-pad">
        <h2 className="text-lg font-bold text-white">Stage 6 — Review & refine</h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-100/55">
          Nothing here is final: every script, scene, visual, voiceover and caption keeps a version history — regenerate or edit any piece without restarting the pipeline.
        </p>
      </div>
      {error && <FriendlyError error={error} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Scenes" value={String(scenes.length)} detail={`${scenes.reduce((s, x) => s + x.duration_sec, 0)}s of footage`} onEdit={() => goTo(1)} />
        <SummaryStat label="Visuals" value={byScene.filter((b) => b.img?.currentVersion).length + '/' + scenes.length} detail="AI scene images ready" onEdit={() => goTo(2)} />
        <SummaryStat label="Voiceovers" value={byScene.filter((b) => b.aud?.currentVersion).length + '/' + scenes.length} detail="TTS per scene" onEdit={() => goTo(2)} />
        <SummaryStat label="Final video" value={composite?.currentVersion ? 'ready' : '—'} detail={composite?.currentVersion?.durationSec != null ? `~${Math.round(composite.currentVersion.durationSec)}s · v${composite.currentVersion.version}` : 'not assembled yet'} onEdit={() => goTo(3)} />
      </div>
      {data.metadata.length > 0 && (
        <div className="card card-pad">
          <div className="mb-2 flex items-center justify-between">
            <div className="label mb-0">Platform metadata</div>
            <button className="text-xs font-semibold text-brand-300" onClick={() => goTo(4)}>edit →</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.metadata.map((m) => (
              <div key={m.platform} className="chip">
                <BrandIcon platform={m.platform} size={13} /> v{m.version} · {m.title.length > 40 ? m.title.slice(0, 40) + '…' : m.title}
              </div>
            ))}
          </div>
        </div>
      )}
      {!allReady && (
        <EmptyState
          icon={<Pencil size={24} />}
          title={byScene.length ? 'Some scenes still need assets' : 'Start with a script'}
          body={byScene.length ? 'Generate the missing visuals and voiceovers, then assemble.' : 'Head to the Script step to create a scene breakdown.'}
          action={<Button variant="primary" onClick={() => goTo(byScene.length ? 2 : 1)}>Continue</Button>}
        />
      )}
    </div>
  );
}

function SummaryStat({ label, value, detail, onEdit }: { label: string; value: string; detail: string; onEdit: () => void }) {
  return (
    <button onClick={onEdit} className="card card-pad text-left transition hover:border-brand-300/40">
      <div className="label">{label}</div>
      <div className="text-2xl font-extrabold text-white">{value}</div>
      <div className="mt-1 text-xs text-brand-100/50">{detail}</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// STAGE 7 — PUBLISH
// ---------------------------------------------------------------------------

const JOB_TONE: Record<string, 'ok' | 'warn' | 'err' | 'brand' | 'default'> = {
  published: 'ok', draft_ready: 'warn', queued: 'default', processing: 'brand', failed: 'err', needs_action: 'err',
};

export function PublishPanel({
  project, jobs, platforms, refresh, stageStates,
}: {
  project: ProjectDetail;
  jobs: PublishJobInfo[];
  platforms: Array<{ platform: string; label: string; connection: { status: string; displayName: string | null } | null; gateNote: string; gate: string; format: { aspect: string } }>;
  refresh: () => Promise<void>;
  stageStates: Record<string, string>;
}) {
  const [mode, setMode] = useState<'auto' | 'draft'>('auto');
  const [schedule, setSchedule] = useState('');
  const [publishing, setPublishing] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function publish(platform: string) {
    setPublishing(platform);
    setError(null);
    setNotice(null);
    const body: any = { platform, mode };
    if (schedule) body.scheduledFor = new Date(schedule).toISOString();
    const { data, error: err } = await runAction<{ jobId: string }>(() => api.post(`/projects/${project.id}/publish`, body));
    if (err) setError(err);
    else {
      setNotice(mode === 'draft' ? 'Draft job queued — nothing goes live until you approve it on the platform.' : schedule ? 'Scheduled — the job queue will publish at your chosen time.' : 'Publish job queued — the demo channel answers in a few seconds.');
    }
    await refresh();
    setPublishing(null);
  }

  async function retry(job: PublishJobInfo) {
    setError(null);
    const { error: err } = await runAction(() => api.post(`/projects/${project.id}/publish-jobs/${job.id}/retry`));
    if (err) setError(err);
    await refresh();
  }

  return (
    <div className="space-y-5">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Stage 7 — Schedule & publish</h2>
          <p className="max-w-2xl text-sm text-brand-100/55">
            OAuth-connected channels only (no passwords ever). Draft mode keeps control; auto-publish ships immediately or at the scheduled time.
            Demo connections simulate each platform so the queue, retries and monitoring are fully testable.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg bg-brand-950/70 p-0.5 text-xs font-semibold">
            {(['auto', 'draft'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 transition ${mode === m ? 'bg-brand-400 text-brand-950' : 'text-brand-100/60'}`}>
                {m === 'auto' ? 'Auto-publish' : 'Draft only'}
              </button>
            ))}
          </div>
          <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="input w-auto py-1.5 text-xs" />
        </div>
      </div>
      {error && <FriendlyError error={error} />}
      {notice && <div className="animate-fadeUp rounded-xl border border-brand-300/25 bg-brand-400/10 px-4 py-3 text-sm text-brand-100">✓ {notice}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        {platforms.map((p) => {
          const connected = p.connection?.status === 'connected';
          return (
            <div key={p.platform} className="card card-pad">
              <div className="mb-3 flex items-center gap-3">
                <BrandIcon platform={p.platform} size={26} />
                <div>
                  <div className="font-semibold text-white">{p.label}</div>
                  <div className="text-[11px] text-brand-100/50">
                    {connected ? p.connection!.displayName : p.gate === 'none' ? 'not connected' : 'requires ' + p.gate.replace(/-/g, ' ')}
                  </div>
                </div>
                <span className="ml-auto">
                  {connected ? <Badge tone="ok"><Check size={10} /> connected</Badge> : <Badge>no channel</Badge>}
                </span>
              </div>
              <div className="mb-3 flex gap-2 text-[11px] text-brand-100/50">
                <span className="chip">{p.format.aspect}</span>
                <span className="chip">max caption {p.format.aspect === '9:16' ? '2,200' : '5,000'} ch</span>
              </div>
              <Button
                variant="primary"
                className="w-full"
                disabled={!connected}
                onClick={() => publish(p.platform)}
                loading={publishing === p.platform}
              >
                {publishing === p.platform ? <Send size={14} /> : <Rocket size={14} />}
                {mode === 'draft' ? 'Send as draft' : schedule ? 'Schedule publish' : 'Publish now'}
              </Button>
              {!connected && <p className="mt-2 text-[11px] leading-relaxed text-brand-100/40">{p.gateNote}</p>}
            </div>
          );
        })}
      </div>

      <div className="card card-pad">
        <div className="mb-3 flex items-center justify-between">
          <div className="label mb-0">Publish jobs</div>
          <button className="text-xs font-semibold text-brand-300" onClick={() => api.post('/analytics/sync').then(refresh)}>sync analytics now</button>
        </div>
        {jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-100/40">No publish jobs yet — connect a channel and hit publish.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
                <BrandIcon platform={j.platform} size={18} />
                <Badge tone={JOB_TONE[j.status] ?? 'default'}>{j.status.replace(/_/g, ' ')}</Badge>
                <span className="text-xs text-brand-100/55">{j.mode} · attempts {j.attempts}/{j.maxAttempts} · {j.createdAt.slice(0, 16).replace('T', ' ')}</span>
                {j.platformUrl && <a className="text-xs font-semibold text-brand-300 hover:underline" href={j.platformUrl} target="_blank" rel="noreferrer">view ↗</a>}
                <span className="ml-auto flex gap-2">
                  {(j.status === 'failed' || j.status === 'needs_action') && (
                    <Button size="sm" className="px-2 py-1 text-[11px]" onClick={() => retry(j)}>retry</Button>
                  )}
                </span>
                {j.lastError && <div className="w-full text-[11px] text-rose-200/80">{j.lastError}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
