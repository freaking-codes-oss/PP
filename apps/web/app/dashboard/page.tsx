'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clapperboard, Eye, Heart, MessageCircle, Plus, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, EmptyState, FriendlyError, Spinner } from '@/components/ui';
import { useSession } from '@/lib/session';

interface ProjectSummary {
  id: string;
  name: string;
  currentStage: string;
  stageStates: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  totals: { views: number; likes: number; comments: number };
  published: number;
}

const STAGE_LABEL: Record<string, string> = {
  ideation: 'Idea', script: 'Script', assets: 'Assets', assembly: 'Assembly', metadata: 'Metadata', review: 'Review', publish: 'Publish',
};

const IDEA_EXAMPLES = [
  'A viral hack for keeping houseplants alive',
  'How creators batch a week of content in one hour',
  'The science of better sleep in under 3 minutes',
  'Overlooked keyboard shortcuts that save an hour a day',
];

export default function DashboardPage() {
  const router = useRouter();
  const { user } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [idea, setIdea] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const ideaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<{ projects: ProjectSummary[] }>('/projects').then((d) => setProjects(d.projects)).catch((e: any) => setError({ message: e.message, suggestion: e.suggestion }));
  }, []);

  async function createProject() {
    setCreating(true);
    setError(null);
    try {
      const data = await api.post<{ project: ProjectSummary }>('/projects', { name: name || idea || 'Untitled video', idea });
      router.push(`/dashboard/studio/${data.project.id}`);
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
      setCreating(false);
    }
  }

  function useExample(ex: string) {
    setIdea(ex);
    setName(ex.split(' ').slice(0, 5).join(' '));
    setShowNew(true);
    setTimeout(() => ideaRef.current?.focus(), 50);
  }

  return (
    <div className="animate-fadeUp space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Good {hourGreeting()}, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="mt-1 text-brand-100/60">Turn one idea into published, measured video.</p>
        </div>
        <Button variant="primary" onClick={() => setShowNew((v) => !v)}>
          <Plus size={16} /> New video idea
        </Button>
      </div>

      {showNew && (
        <div className="card card-pad animate-fadeUp space-y-4">
          <div>
            <label className="label">What should the video be about?</label>
            <input
              ref={ideaRef}
              className="input text-base"
              placeholder="e.g. The untold science behind productive mornings"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {IDEA_EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => useExample(ex)} className="chip hover:border-brand-300/40 hover:bg-brand-400/10">
                  <Sparkles size={12} className="text-brand-300" /> {ex.length > 46 ? ex.slice(0, 46) + '…' : ex}
                </button>
              ))}
            </div>
          </div>
          {error && <FriendlyError error={error} />}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowNew(false)}>Cancel</Button>
            <Button variant="primary" onClick={createProject} loading={creating}>
              Start the pipeline →
            </Button>
          </div>
        </div>
      )}

      {projects === null && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-44 animate-pulse" />
          ))}
        </div>
      )}

      {projects !== null && projects.length === 0 && !showNew && (
        <EmptyState
          icon={<Sparkles size={30} />}
          title="Your canvas is empty"
          body="Drop in a topic and CAS will take it from angles and script to a finished, publish-ready video — then keep an eye on how it performs."
          action={
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {IDEA_EXAMPLES.slice(0, 3).map((ex) => (
                <button key={ex} onClick={() => useExample(ex)} className="chip">
                  <Sparkles size={12} className="text-brand-300" /> {ex.length > 40 ? ex.slice(0, 40) + '…' : ex}
                </button>
              ))}
            </div>
          }
        />
      )}

      {projects !== null && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const states = Object.values(p.stageStates);
            const done = states.filter((s) => s === 'ready').length;
            const pct = Math.round((done / 7) * 100);
            return (
              <Link key={p.id} href={`/dashboard/studio/${p.id}`} className="card card-pad group transition hover:border-brand-300/30 hover:bg-white/[0.06]">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 font-semibold leading-snug text-white group-hover:text-brand-100">{p.name}</h3>
                  <Badge tone="brand">{done}/7 done</Badge>
                </div>
                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand-300 to-brand-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="mb-4 flex items-center justify-between text-xs text-brand-100/60">
                  <span>
                    At <span className="font-semibold text-brand-200">{STAGE_LABEL[p.currentStage] ?? p.currentStage}</span>
                  </span>
                  <span>{p.published ? `${p.published} published` : 'not published yet'}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
                  <Stat icon={<Eye size={14} />} value={fmt(p.totals.views)} label="views" />
                  <Stat icon={<Heart size={14} />} value={fmt(p.totals.likes)} label="likes" />
                  <Stat icon={<MessageCircle size={14} />} value={fmt(p.totals.comments)} label="comments" />
                </div>
              </Link>
            );
          })}
          <button
            onClick={() => setShowNew(true)}
            className="flex min-h-[13rem] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 text-brand-100/50 transition hover:border-brand-300/40 hover:text-brand-200"
          >
            <Plus size={26} />
            <span className="text-sm font-semibold">New video idea</span>
          </button>
        </div>
      )}
      {error && projects === null && (
        <EmptyState icon={<Clapperboard size={30} />} title="Could not load your projects" body={error.message} action={<Button onClick={() => location.reload()}>Reload</Button>} />
      )}
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-brand-100/80">
      <span className="text-brand-300/70">{icon}</span>
      <span className="font-bold text-white">{value}</span>
      <span className="hidden text-[10px] uppercase tracking-wide text-brand-100/40 sm:inline">{label}</span>
    </div>
  );
}

function hourGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
