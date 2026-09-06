'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clapperboard, Plus, RefreshCw, TrendingUp, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, EmptyState, FriendlyError } from '@/components/ui';
import { BrandIcon } from '@/components/icons';

interface TrendItem {
  id: string;
  title: string;
  source: string;
  category: string | null;
  region: string | null;
  score: number | null;
  reason: string | null;
  pickedAt: string;
}

const REGIONS = ['US', 'GB', 'IN', 'BR', 'DE', 'JP', ''];

export default function TrendsPage() {
  const router = useRouter();
  const [trends, setTrends] = useState<TrendItem[] | null>(null);
  const [region, setRegion] = useState('US');
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  const load = useCallback(async () => {
    const q = region ? `?region=${region}` : '';
    try {
      const d = await api.get<{ trends: TrendItem[] }>(`/trends${q}&limit=60`);
      setTrends(d.trends);
      setError(null);
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
  }, [region]);

  useEffect(() => { load(); }, [load]);

  async function addManual() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/trends/manual', { title, category: category || undefined, reason: reason || undefined });
      setTitle(''); setCategory(''); setReason(''); setShowAdd(false);
      await load();
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
    setBusy(false);
  }

  async function remove(id: string) {
    await api.del(`/trends/${id}`).catch(() => undefined);
    await load();
  }

  async function scanNow() {
    setBusy(true);
    await api.post('/trends/scan').catch(() => undefined);
    setTimeout(async () => { await load(); setBusy(false); }, 1500);
  }

  function makeVideo(t: TrendItem) {
    router.push('/dashboard');
    // land on dashboard; creation happens through the new-idea form pre-filled
    router.push(`/dashboard/studio/new?idea=${encodeURIComponent(t.title)}`);
  }

  return (
    <div className="animate-fadeUp space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white"><TrendingUp size={22} className="text-brand-300" /> Trends</h1>
          <p className="mt-1 text-brand-100/60">Rising topics to feed your next idea. YouTube-style popular feed (auto) + your manual picks for platforms without a discovery API.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={scanNow} loading={busy}><RefreshCw size={15} /> Refresh scan</Button>
          <Button variant="primary" onClick={() => setShowAdd((s) => !s)}><Plus size={15} /> Add a trend</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {REGIONS.map((r) => (
          <button key={r || 'all'} onClick={() => setRegion(r)} className={`chip transition ${region === r ? 'border-brand-300/60 bg-brand-400/15 text-brand-100' : 'hover:border-white/25'}`}>
            {r || 'All regions'}
          </button>
        ))}
      </div>

      {showAdd && (
        <div className="card card-pad animate-fadeUp space-y-3">
          <h3 className="text-sm font-bold text-white">Manual trend pick</h3>
          <p className="text-xs text-brand-100/55">TikTok & Instagram have no full official trend API — curate what you see so it feeds Stage 1 ideation.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input className="input" placeholder="Title — e.g. “POV: your 6am alarm actually works”" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="input" placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <input className="input" placeholder="Why is it worth making content about? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="primary" onClick={addManual} loading={busy}>Add trend</Button>
          </div>
        </div>
      )}

      {error && <FriendlyError error={error} />}

      {trends === null && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...Array(6)].map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}</div>}

      {trends && trends.length === 0 && (
        <EmptyState icon={<TrendingUp size={26} />} title="No trend entries for this region yet" body="Run a scan or add your first manual trend — they show up here and become optional context in the ideation step." />
      )}

      {trends && trends.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {trends.map((t, i) => (
            <div key={t.id} className="card card-pad flex flex-col gap-2 transition hover:border-white/20">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex items-center gap-1.5 font-semibold text-brand-200">
                  {t.source === 'youtube-most-popular' ? <><BrandIcon platform="youtube" size={12} /> YouTube-style popular</> : <><Clapperboard size={12} /> manual pick</>}
                </span>
                <Badge tone={t.source === 'manual' ? 'warn' : 'brand'}>#{i + 1}</Badge>
              </div>
              <h3 className="text-sm font-semibold leading-snug text-white">{t.title}</h3>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {t.category && <span className="chip">{t.category}</span>}
                {t.region && <span className="chip">{t.region}</span>}
                {t.score != null && (
                  <span className="chip">
                    <span className="h-1.5 w-8 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full rounded-full bg-amber-300" style={{ width: `${t.score}%` }} />
                    </span>
                    {t.score}
                  </span>
                )}
              </div>
              {t.reason && <p className="text-[11px] text-brand-100/45">{t.reason}</p>}
              <div className="mt-auto flex items-center justify-between pt-1">
                <button onClick={() => makeVideo(t)} className="text-xs font-bold text-brand-300 hover:text-brand-200">Make a video →</button>
                {t.source === 'manual' && (
                  <button onClick={() => remove(t.id)} className="text-brand-100/30 transition hover:text-rose-300"><Trash2 size={13} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
