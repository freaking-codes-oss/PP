'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogoSvg } from '@/components/icons';
import { useSession } from '@/lib/session';
import { Button, FriendlyError } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { user, signIn, demoSignIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError({ message: err.message, suggestion: err.suggestion });
    } finally {
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    try {
      await demoSignIn();
      router.push('/dashboard');
    } catch (err: any) {
      setError({ message: err.message, suggestion: err.suggestion });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="rounded-2xl border border-brand-300/30 bg-white/5 p-3"><LogoSvg size={38} /></div>
        <div>
          <h1 className="text-lg font-bold text-white">Sign in to Content Automation Studio</h1>
          <p className="text-sm text-brand-100/50">prompt → published → measured</p>
        </div>
      </div>
      <form onSubmit={submit} className="card card-pad space-y-4">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <FriendlyError error={error} />}
        <Button variant="primary" className="w-full" type="submit" loading={busy}>Sign in</Button>
        <Button className="w-full border-brand-300/40 bg-brand-400/15 text-brand-100 hover:bg-brand-400/25" onClick={demo} loading={busy} type="button">
          Explore the demo instead
        </Button>
        <p className="text-center text-xs text-brand-100/40">
          No account yet? <a href="/" className="font-semibold text-brand-300 hover:underline">Create one →</a>
        </p>
      </form>
    </main>
  );
}
