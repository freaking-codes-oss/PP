'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogoSvg } from '@/components/icons';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, FriendlyError, Spinner } from '@/components/ui';

const EXAMPLES = [
  'The untold science behind productive mornings',
  'How creators batch a week of content in one hour',
  'Beginner photography: natural light only',
  'Overlooked keyboard shortcuts that save an hour a day',
];

export default function NewStudioPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useSession();
  const [idea, setIdea] = useState(params.get('idea') ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  useEffect(() => {
    if (!idea && params.get('idea')) setIdea(params.get('idea')!);
    if (!name && idea) setName(idea.split(' ').slice(0, 5).join(' '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, idea]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<{ project: { id: string } }>('/projects', { name: name || idea || 'Untitled video', idea });
      router.push(`/dashboard/studio/${d.project.id}`);
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-10">
      <div className="flex items-center gap-3">
        <LogoSvg size={34} />
        <div>
          <h1 className="text-xl font-bold text-white">Start a new video</h1>
          <p className="text-sm text-brand-100/55">One idea in. A published, measured video out.</p>
        </div>
      </div>
      <div className="card card-pad space-y-4">
        <div>
          <label className="label">The idea</label>
          <textarea
            className="input min-h-[110px] resize-y text-base"
            placeholder="Describe the video you want to make…"
            value={idea}
            onChange={(e) => { setIdea(e.target.value); if (!name) setName(e.target.value.split(' ').slice(0, 5).join(' ')); }}
            autoFocus
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setIdea(ex)} className="chip hover:border-brand-300/40 hover:bg-brand-400/10">
              {ex}
            </button>
          ))}
        </div>
        <div>
          <label className="label">Project name (optional)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My first video" />
        </div>
        {error && <FriendlyError error={error} />}
        <div className="flex items-center justify-between">
          <span className="text-xs text-brand-100/40">Signed in as {user?.email}</span>
          <Button variant="primary" onClick={start} loading={busy} disabled={!idea.trim()}>
            {busy ? 'Creating…' : 'Create & open the wizard →'}
          </Button>
        </div>
      </div>
    </div>
  );
}
