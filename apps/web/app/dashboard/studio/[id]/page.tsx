'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Play, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useProjectData } from '@/components/studio/hooks';
import { Stepper, STEPS } from '@/components/studio/Stepper';
import { IdeationPanel, ScriptPanel } from '@/components/studio/Panels1';
import { AssetsPanel, AssemblyPanel, MetadataPanel, ReviewPanel, PublishPanel } from '@/components/studio/Panels2';
import type { AssetInfo, MetadataRow, PlatformRow, PublishJobInfo, StudioData, StylePresetInfo } from '@/components/studio/types';
import { Badge, Button, EmptyState, FriendlyError } from '@/components/ui';

interface ScriptPayload {
  latest: {
    id: string; version: number; source: string; createdAt: string;
    scenes: Array<{ id: string; visual_description: string; voiceover: string; on_screen_text: string; duration_sec: number }>;
    title: string; overview: string;
  } | null;
  versions: Array<{
    id: string; version: number; source: string; createdAt: string; title: string | null;
    scenes: Array<{ id: string; visual_description: string; voiceover: string; on_screen_text: string; duration_sec: number }>;
  }>;
}

export default function StudioPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { detail, error: detailError, refresh: refreshProject, running } = useProjectData(projectId);

  const [script, setScript] = useState<StudioData['script']>(null);
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [metadata, setMetadata] = useState<MetadataRow[]>([]);
  const [jobs, setJobs] = useState<PublishJobInfo[]>([]);
  const [styles, setStyles] = useState<StylePresetInfo[]>([]);
  const [platforms, setPlatforms] = useState<PlatformRow[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoError, setAutoError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; suggestion?: string } | null>(null);

  const refresh = useCallback(async () => {
    const [project] = await Promise.all([refreshProject()]);
    void project;
    try {
      const [s, a, m, j, st, pl] = await Promise.all([
        api.get<ScriptPayload>(`/projects/${projectId}/script`),
        api.get<{ assets: AssetInfo[] }>(`/projects/${projectId}/assets`),
        api.get<{ metadata: MetadataRow[] }>(`/projects/${projectId}/metadata`),
        api.get<{ jobs: PublishJobInfo[] }>(`/projects/${projectId}/publish-jobs`),
        api.get<{ presets: StylePresetInfo[] }>('/style-presets'),
        api.get<{ platforms: PlatformRow[] }>('/publishing/platforms'),
      ]);
      setScript(s.latest ? { latest: s.latest, versions: s.versions } : null);
      setAssets(a.assets);
      setMetadata(m.metadata);
      setJobs(j.jobs);
      setStyles(st.presets);
      setPlatforms(pl.platforms);
      setLoadError(null);
    } catch (e: any) {
      setLoadError({ message: e.message, suggestion: e.suggestion });
    }
  }, [projectId, refreshProject]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stageStates = useMemo(() => detail?.stageStates ?? {}, [detail]);
  useEffect(() => {
    if (!detail) return;
    // open the first step that is not complete
    const idx = STEPS.findIndex((s) => stageStates[s.key] !== 'ready');
    if (idx >= 0) setActiveStep((cur) => (stageStates[STEPS[cur].key] === 'ready' ? idx : cur));
  }, [detail, stageStates]);

  if (!detail && !detailError) {
    return (
      <div className="space-y-5">
        <StudioSkeleton />
      </div>
    );
  }
  if (!detail || detailError) {
    return (
      <div className="animate-fadeUp">
        <FriendlyError error={detailError ?? { message: 'Project could not be loaded.' }} />
        <Button onClick={refresh} className="mt-3">Reload</Button>
      </div>
    );
  }

  const stylePreset = styles.find((s) => s.id === (detail as any).stylePreset?.id) ?? styles.find((s) => s.builtIn && s.name === 'Studio Teal') ?? null;
  const data: StudioData = { project: detail, styles, script, assets, metadata, jobs };

  async function runAuto() {
    setAutoRunning(true);
    setAutoError(null);
    const { error } = await (async () => {
      try {
        await api.post(`/projects/${projectId}/run`, { targetStage: 'review' });
        return { error: null };
      } catch (e: any) {
        return { error: { message: e.message, suggestion: e.suggestion } };
      }
    })();
    if (error) setAutoError(error);
    await refresh();
    setAutoRunning(false);
  }

  const currentStep = STEPS[activeStep];
  const swatches = (detail as any).stylePreset?.swatches ?? [];

  return (
    <div className="animate-fadeUp space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard" className="rounded-lg border border-white/10 p-2 text-brand-100/60 transition hover:text-white"><ArrowLeft size={16} /></Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-white">{detail.name}</h1>
          <div className="flex items-center gap-2 text-[11px] text-brand-100/50">
            {swatches.map((c: string) => <span key={c} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}
            <span>{stylePreset?.name ?? 'no style preset'} · created {new Date(detail.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {running && <Badge tone="brand"><Sparkles size={10} /> generating…</Badge>}
          <Button onClick={refresh} className="px-3 py-2"><RefreshCw size={14} /></Button>
          <Button variant="primary" onClick={runAuto} loading={autoRunning} disabled={running}>
            <Play size={14} /> Auto-run to review
          </Button>
        </div>
      </div>
      {autoError && <FriendlyError error={autoError} />}
      {loadError && <FriendlyError error={loadError} />}

      {/* stepper */}
      <div className="card px-5 py-4">
        <Stepper states={stageStates} active={activeStep} onSelect={(i) => setActiveStep(i)} allowJump={true} />
      </div>

      {/* active panel */}
      <section key={currentStep.key} className="animate-fadeUp">
        {currentStep.key === 'ideation' && (
          <IdeationPanel
            project={detail}
            refresh={refresh}
            stylePresets={styles}
            onApplyStyle={async (id) => {
              await api.patch(`/projects/${projectId}`, { stylePresetId: id });
              await refresh();
            }}
          />
        )}
        {currentStep.key === 'script' && <ScriptPanel project={detail} script={script} refresh={refresh} />}
        {currentStep.key === 'assets' && <AssetsPanel project={detail} script={script} assets={assets} stylePreset={stylePreset} refresh={refresh} />}
        {currentStep.key === 'assembly' && <AssemblyPanel project={detail} assets={assets} stageStates={stageStates} refresh={refresh} />}
        {currentStep.key === 'metadata' && <MetadataPanel project={detail} metadata={metadata} stageStates={stageStates} refresh={refresh} />}
        {currentStep.key === 'review' && <ReviewPanel data={data} goTo={(i) => { setActiveStep(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
        {currentStep.key === 'publish' && <PublishPanel project={detail} jobs={jobs} platforms={platforms} stageStates={stageStates} refresh={refresh} />}
      </section>
    </div>
  );
}

function StudioSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-white/10" />
      <div className="h-24 animate-pulse rounded-2xl bg-white/10" />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="h-48 animate-pulse rounded-2xl bg-white/10" />
        <div className="h-48 animate-pulse rounded-2xl bg-white/10" />
      </div>
    </div>
  );
}
