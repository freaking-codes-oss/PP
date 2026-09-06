'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogoSvg } from '@/components/icons';
import { api, getToken } from '@/lib/api';
import { useSession, type SessionUser } from '@/lib/session';
import { Button, FriendlyError, Spinner } from '@/components/ui';

const LOOP_STEPS = [
  ['1 · Prompt', 'Type an idea or pull a trending topic'],
  ['2 · AI creates', 'Angles → script → scenes → visuals, voiceover & captions'],
  ['3 · Assemble', 'One polished vertical video, styled with your preset'],
  ['4 · Publish', 'YouTube, TikTok, Instagram, Facebook — draft or auto'],
  ['5 · Learn', 'Cross-platform analytics feed your next idea'],
];

export default function LandingPage() {
  const router = useRouter();
  const { user, loading, signIn, demoSignIn, signUp } = useSession();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  // if a token exists from a previous session, let the session provider restore it
  useEffect(() => {
    if (getToken()) {
      api.get<{ user: SessionUser }>('/auth/me').then((d) => {
        if (d.user) router.replace('/dashboard');
      }).catch(() => undefined);
    }
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(mode === 'login' ? 'Signing in…' : 'Creating your studio…');
    try {
      if (mode === 'login') await signIn(email, password);
      else await signUp(name, email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError({ message: err.message ?? 'Something went wrong.', suggestion: err.suggestion });
    } finally {
      setBusy(null);
    }
  }

  async function demo() {
    setError(null);
    setBusy('Opening the demo studio…');
    try {
      await demoSignIn();
      router.push('/dashboard');
    } catch (err: any) {
      setError({ message: err.message ?? 'Demo access is unavailable right now.', suggestion: err.suggestion });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2 lg:gap-16">
      <section className="animate-fadeUp">
        <div className="mb-7 flex items-center gap-3">
          <div className="rounded-2xl border border-brand-300/30 bg-white/5 p-2.5">
            <LogoSvg size={34} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Content Automation Studio</h1>
            <p className="text-sm text-brand-100/60">one idea → published video → measurable growth</p>
          </div>
        </div>
        <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-[2.6rem] sm:leading-[1.15]">
          Your idea, produced and shipped to{' '}
          <span className="bg-gradient-to-r from-brand-300 to-amber-200 bg-clip-text text-transparent">every short-form platform</span>.
        </h2>
        <p className="mt-4 max-w-lg text-brand-100/70">
          A closed loop: type a prompt, get AI-expanded angles, a scene script, visuals and voiceover — then publish to
          YouTube, TikTok, Instagram and Facebook, and watch cross-platform analytics come back into your next idea.
        </p>
        <ul className="mt-7 space-y-2.5">
          {LOOP_STEPS.map(([k, v]) => (
            <li key={k} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 rounded-md bg-brand-400/15 px-2 py-0.5 text-xs font-bold text-brand-200">{k}</span>
              <span className="text-brand-100/75">{v}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="animate-fadeUp [animation-delay:.1s]">
        <div className="card overflow-hidden">
          <div className="border-b border-white/10 bg-gradient-to-br from-brand-400/15 to-transparent px-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-white">{mode === 'login' ? 'Welcome back' : 'Create your studio'}</h3>
              <div className="flex rounded-lg bg-brand-950/60 p-0.5 text-xs">
                <button
                  className={`rounded-md px-3 py-1.5 font-semibold transition ${mode === 'login' ? 'bg-white/10 text-white' : 'text-brand-100/60 hover:text-white'}`}
                  onClick={() => setMode('login')}
                >
                  Sign in
                </button>
                <button
                  className={`rounded-md px-3 py-1.5 font-semibold transition ${mode === 'signup' ? 'bg-white/10 text-white' : 'text-brand-100/60 hover:text-white'}`}
                  onClick={() => setMode('signup')}
                >
                  Create account
                </button>
              </div>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4 px-6 py-6">
            {mode === 'signup' && (
              <div>
                <label className="label">Display name</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="You, the creator" required minLength={1} />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? '6+ characters' : 'Your password'} required minLength={mode === 'signup' ? 6 : 1} />
            </div>
            {error && <FriendlyError error={error} />}
            <Button variant="primary" type="submit" loading={busy !== null} className="w-full">
              {mode === 'login' ? 'Sign in to the studio' : 'Create account'}
            </Button>
          </form>
          <div className="px-6 pb-6">
            <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-widest text-brand-100/40">
              <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
            </div>
            <Button onClick={demo} loading={busy !== null} className="w-full border-brand-300/40 bg-brand-400/15 text-brand-100 hover:bg-brand-400/25">
              {busy ? 'Opening demo…' : '▶ Explore the pre-loaded demo'}
            </Button>
            <p className="mt-3 text-center text-xs text-brand-100/45">
              Demo comes with published videos, analytics & trends — no keys needed.
            </p>
          </div>
        </div>
        {loading && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-brand-100/50">
            <Spinner /> restoring your session…
          </div>
        )}
      </section>
    </main>
  );
}
