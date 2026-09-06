'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Clapperboard, LayoutDashboard, LogOut, Menu, Settings, Sparkles, TrendingUp, X } from 'lucide-react';
import { LogoSvg } from '@/components/icons';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/trends', label: 'Trends', icon: TrendingUp },
  { href: '/dashboard/analytics', label: 'Performance', icon: BarChart3 },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, signOut } = useSession();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-brand-100/60">
        <Spinner /> Loading your studio…
      </div>
    );
  }

  const initials = (user.name || user.email)
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl">
      {/* sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 bg-brand-900/30 px-4 py-6 lg:flex">
        <Link href="/dashboard" className="mb-8 flex items-center gap-2.5 px-1">
          <LogoSvg size={30} />
          <div>
            <div className="text-[13px] font-bold leading-tight text-white">Content Automation</div>
            <div className="text-[10px] uppercase tracking-[.18em] text-brand-300/80">Studio</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? 'bg-brand-400/15 text-brand-100' : 'text-brand-100/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <item.icon size={17} /> {item.label}
              </Link>
            );
          })}
          <Link
            href="/dashboard/studio/new"
            className={`mt-3 flex items-center gap-3 rounded-xl border border-dashed border-brand-300/40 px-3 py-2.5 text-sm font-medium text-brand-200 transition hover:bg-brand-400/10 ${
              pathname.startsWith('/dashboard/studio') ? 'bg-brand-400/10' : ''
            }`}
          >
            <Clapperboard size={17} /> New video…
          </Link>
        </nav>
        <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-300 to-brand-600 text-xs font-bold text-brand-950">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white">{user.name}</div>
            <div className="truncate text-[11px] text-brand-100/50">{user.email}</div>
          </div>
          <button title="Sign out" onClick={signOut} className="text-brand-100/50 transition hover:text-white">
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-white/10 bg-brand-950/85 px-4 backdrop-blur lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <LogoSvg size={24} />
          <span className="text-sm font-bold text-white">Content Automation Studio</span>
        </Link>
        <button onClick={() => setOpen((o) => !o)} className="rounded-lg p-2 hover:bg-white/10">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-14 z-20 border-b border-white/10 bg-brand-950/95 px-4 py-3 backdrop-blur lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-100/80 hover:bg-white/5"
            >
              <item.icon size={17} /> {item.label}
            </Link>
          ))}
          <button onClick={() => { signOut(); }} className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-100/60">
            <LogOut size={17} /> Sign out ({user.name})
          </button>
        </div>
      )}

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-7 lg:px-9 lg:py-8">{children}</main>
    </div>
  );
}

export default Shell;
