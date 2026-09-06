'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowUpRight, BarChart3, Eye, Heart, MessageCircle, RefreshCw, Share2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, EmptyState } from '@/components/ui';
import { BrandIcon } from '@/components/icons';
import type { PlatformRow } from '@/components/studio/types';

interface OverviewProject {
  projectId: string;
  name: string;
  totals: { views: number; likes: number; shares: number; comments: number };
  series: Array<{ day: string; views: number; likes: number }>;
}

interface VideoSeries {
  platform: string;
  externalVideoId: string;
  projectId: string;
  url?: string | null;
  points: Array<{ collectedAt: string; views: number; likes: number; shares: number; comments: number }>;
}

const PLATFORM_COLORS: Record<string, string> = {
  youtube: '#FF0000', tiktok: '#69C9D0', instagram: '#E4405F', facebook: '#0866FF',
};

export default function AnalyticsPage() {
  const [projects, setProjects] = useState<OverviewProject[] | null>(null);
  const [total, setTotal] = useState({ views: 0, likes: 0, shares: 0, comments: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [series, setSeries] = useState<VideoSeries[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    const d = await api.get<{ projects: OverviewProject[]; totals: typeof total }>('/analytics/overview?days=14');
    setProjects(d.projects);
    setTotal(d.totals);
    if (d.projects[0] && !d.projects.find((p) => p.projectId === selected)) setSelected(d.projects[0].projectId);
    setBusy(false);
  };

  useEffect(() => { load().catch(() => undefined); }, []);
  useEffect(() => {
    if (!selected) return;
    api.get<{ series: VideoSeries[] }>(`/analytics/projects/${selected}/series?days=30`)
      .then((d) => setSeries(d.series))
      .catch(() => undefined);
  }, [selected]);

  interface SeriesRow {
    day: string;
    [platform: string]: number | string;
  }
  const chartData = useMemo(() => {
    const map = new Map<string, SeriesRow>();
    for (const v of series) {
      for (const p of v.points) {
        const day = p.collectedAt.slice(0, 10);
        const row = map.get(day) ?? { day };
        const prior = typeof row[v.platform] === 'number' ? (row[v.platform] as number) : 0;
        row[v.platform] = Math.max(prior, p.views);
        map.set(day, row);
      }
    }
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [series]);

  const activeProject = projects?.find((p) => p.projectId === selected);

  return (
    <div className="animate-fadeUp space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><BarChart3 size={22} className="text-brand-300" /> Performance</h1>
          <p className="mt-1 text-brand-100/60">Every platform’s numbers, normalized into one timeline — pull them into your next idea.</p>
        </div>
        <Button onClick={() => api.post('/analytics/sync').then(load)} loading={busy}><RefreshCw size={15} /> Sync now</Button>
      </div>

      {/* totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat icon={<Eye size={18} />} label="Views" value={fmt(total.views)} />
        <BigStat icon={<Heart size={18} />} label="Likes" value={fmt(total.likes)} tone="text-rose-300" />
        <BigStat icon={<Share2 size={18} />} label="Shares" value={fmt(total.shares)} tone="text-brand-300" />
        <BigStat icon={<MessageCircle size={18} />} label="Comments" value={fmt(total.comments)} tone="text-amber-200" />
      </div>

      {projects !== null && projects.length === 0 && (
        <EmptyState icon={<BarChart3 size={26} />} title="No published videos yet" body="Once you publish, CAS pulls views, likes, shares and comments from every connected platform into this dashboard." />
      )}

      {projects !== null && projects.length > 0 && (
        <>
          {/* project switcher */}
          <div className="flex flex-wrap gap-1.5">
            {projects.map((p) => (
              <button key={p.projectId} onClick={() => setSelected(p.projectId)} className={`chip ${selected === p.projectId ? 'border-brand-300/60 bg-brand-400/15 text-white' : ''}`}>
                {p.name.length > 34 ? p.name.slice(0, 34) + '…' : p.name}
              </button>
            ))}
          </div>

          {activeProject && (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="card card-pad lg:col-span-2">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-semibold text-white">Views · last 30 days</h2>
                  <Link href={`/dashboard/studio/${activeProject.projectId}`} className="text-xs font-bold text-brand-300 hover:text-brand-200">open project ↗</Link>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        {Object.keys(PLATFORM_COLORS).map((p) => (
                          <linearGradient key={p} id={`grad-${p}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={PLATFORM_COLORS[p]} stopOpacity={0.4} />
                            <stop offset="100%" stopColor={PLATFORM_COLORS[p]} stopOpacity={0.02} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: 'rgba(230,245,241,.45)', fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'rgba(230,245,241,.45)', fontSize: 11 }} width={44} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#0b2e2a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, color: '#e6f5f1' }} />
                      <Legend />
                      {Object.keys(PLATFORM_COLORS).map((p) => (
                        <Area key={p} type="monotone" dataKey={p} name={p} stroke={PLATFORM_COLORS[p]} strokeWidth={2} fill={`url(#grad-${p})`} connectNulls />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* per-video breakdown */}
              <div className="card card-pad overflow-auto">
                <h2 className="mb-3 font-semibold text-white">Videos</h2>
                <div className="space-y-3">
                  {series.map((v) => {
                    const last = v.points[v.points.length - 1];
                    const first = v.points[0];
                    const growth = first && first.views > 0 ? Math.round(((last.views - first.views) / first.views) * 100) : 0;
                    return (
                      <div key={v.externalVideoId} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                        <div className="mb-1.5 flex items-center justify-between">
                          <BrandIcon platform={v.platform} size={15} />
                          <Badge tone={growth >= 0 ? 'ok' : 'warn'}>{growth >= 0 ? '+' : ''}{growth}%</Badge>
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-extrabold text-white">{last ? fmt(last.views) : '0'}</span>
                          <span className="text-[11px] text-brand-100/45">views · {v.points.length} snapshots</span>
                        </div>
                        <div className="mt-2 flex gap-3 text-[11px] text-brand-100/55">
                          <span>♥ {last ? fmt(last.likes) : 0}</span>
                          <span>↗ {last ? fmt(last.shares) : 0}</span>
                          <span>💬 {last ? fmt(last.comments) : 0}</span>
                        </div>
                        {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-brand-300">open on platform <ArrowUpRight size={10} /></a>}
                      </div>
                    );
                  })}
                  {series.length === 0 && <p className="text-sm text-brand-100/40">Analytics will appear after the first sync.</p>}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {projects === null && <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <div key={i} className="card h-40 animate-pulse" />)}</div>}
    </div>
  );
}

function BigStat({ icon, label, value, tone = 'text-white' }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2 text-brand-100/60">{icon}<span className="text-xs font-semibold uppercase tracking-wider">{label}</span></div>
      <div className={`mt-1.5 text-2xl font-extrabold ${tone}`}>{value}</div>
    </div>
  );
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
