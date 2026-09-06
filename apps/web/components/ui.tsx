'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading, children, disabled, className = '', ...rest }: BtnProps) {
  const cls =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'secondary'
        ? 'btn-secondary'
        : variant === 'danger'
          ? 'btn-danger'
          : 'btn-ghost';
  const sizeCls = size === 'sm' ? '!px-2.5 !py-1.5 !text-xs' : '';
  return (
    <button className={`${cls} ${sizeCls} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'ok' | 'warn' | 'err' | 'brand' }) {
  const map = {
    default: 'border-white/10 bg-white/5 text-brand-100/80',
    ok: 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200',
    warn: 'border-amber-300/25 bg-amber-400/10 text-amber-200',
    err: 'border-rose-300/25 bg-rose-400/10 text-rose-200',
    brand: 'border-brand-300/30 bg-brand-400/10 text-brand-100',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${map[tone]}`}>{children}</span>;
}

export function FriendlyError({ error }: { error: { message?: string; suggestion?: string } | null }) {
  if (!error?.message) return null;
  return (
    <div className="animate-fadeUp rounded-xl border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
      <p className="font-semibold">{error.message}</p>
      {error.suggestion && <p className="mt-0.5 text-rose-200/80">{error.suggestion}</p>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card card-pad flex flex-col items-center gap-3 py-14 text-center">
      {icon && <div className="text-brand-300/80">{icon}</div>}
      <h3 className="text-lg font-semibold text-brand-50">{title}</h3>
      {body && <p className="max-w-md text-sm text-brand-100/60">{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 ${className}`} />;
}

export function ProgressBar({ value, color = 'bg-brand-300' }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
