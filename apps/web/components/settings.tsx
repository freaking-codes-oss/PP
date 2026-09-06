'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check, Eye, EyeOff, KeyRound, Link2, Plug, Plus, ShieldCheck, Trash2, Unplug, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { PlatformRow } from '@/components/studio/types';
import { Badge, Button, EmptyState, FriendlyError } from '@/components/ui';
import { BrandIcon } from '@/components/icons';

export function SettingsTabs({ active }: { active: 'channels' | 'providers' | 'presets' }) {
  const tabs = [
    { key: 'channels', href: '/dashboard/settings/channels', label: 'Channels' },
    { key: 'providers', href: '/dashboard/settings/providers', label: 'AI providers' },
    { key: 'presets', href: '/dashboard/settings/presets', label: 'Style presets' },
  ] as const;
  return (
    <div className="flex gap-1.5">
      {tabs.map((t) => (
        <a key={t.key} href={t.href} className={`chip ${active === t.key ? 'border-brand-300/60 bg-brand-400/15 text-white' : ''}`}>
          {t.label}
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CHANNELS
// ---------------------------------------------------------------------------

export function ChannelsSettings() {
  const [platforms, setPlatforms] = useState<PlatformRow[] | null>(null);
  const [oauth, setOauth] = useState<{ googleConfigured: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api.get<{ platforms: PlatformRow[]; oauth: { googleConfigured: boolean } }>('/publishing/platforms');
    setPlatforms(d.platforms);
    setOauth(d.oauth);
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function connectDemo(platform: string) {
    setBusy(platform);
    setError(null);
    try {
      await api.post('/publishing/connections/demo', { platform });
      setNotice('Demo channel connected — publishing & analytics are simulated for this session.');
      await load();
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
    setBusy(null);
  }

  async function startOAuth(platform: string) {
    setBusy(platform);
    setError(null);
    try {
      const d = await api.get<{ url: string }>(`/publishing/oauth/start?platform=${platform}`);
      window.location.href = d.url;
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
    setBusy(null);
  }

  async function disconnect(platform: string) {
    await api.post(`/publishing/connections/${platform}/disconnect`);
    await load();
  }

  const gateTone: Record<string, 'default' | 'warn' | 'err' | 'ok'> = {
    none: 'ok', 'oauth-verification': 'warn', 'tiktok-audit': 'warn', 'meta-app-review': 'warn',
  };

  return (
    <div className="space-y-5">
      <div className="card card-pad bg-gradient-to-br from-brand-400/10 to-transparent">
        <h2 className="font-bold text-white">Connected channels</h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-100/60">
          Connections use OAuth 2.0 only — CAS never sees or stores platform passwords, just encrypted access + refresh tokens.
          The demo connection simulates a channel so you can test publishing and analytics without approvals.
        </p>
      </div>
      {notice && <div className="animate-fadeUp rounded-xl border border-brand-300/25 bg-brand-400/10 px-4 py-3 text-sm text-brand-100">✓ {notice}</div>}
      {error && <FriendlyError error={error} />}

      <div className="grid gap-3 md:grid-cols-2">
        {platforms?.map((p) => {
          const connected = p.connection?.status === 'connected';
          return (
            <div key={p.platform} className="card card-pad">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-white/5 p-2.5"><BrandIcon platform={p.platform} size={24} /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-white">{p.label}</div>
                  <div className="truncate text-xs text-brand-100/55">{connected ? p.connection!.displayName : 'No channel connected'}</div>
                </div>
                {connected ? <Badge tone="ok"><Check size={11} /> connected</Badge> : <Badge>—</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="chip">{p.format.aspect}</span>
                <span className="chip">≤{p.format.maxDurationSec}s</span>
                <Badge tone={gateTone[p.gate] ?? 'default'}>{p.gate === 'none' ? 'open' : p.gate.replace(/-/g, ' ')}</Badge>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-brand-100/40">{p.gateNote}</p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {connected ? (
                  <Button onClick={() => disconnect(p.platform)}><Unplug size={14} /> Disconnect</Button>
                ) : p.platform === 'youtube' && oauth?.googleConfigured ? (
                  <Button variant="primary" onClick={() => startOAuth(p.platform)} loading={busy === p.platform}><Link2 size={14} /> Connect with Google</Button>
                ) : (
                  <Button variant="primary" onClick={() => connectDemo(p.platform)} loading={busy === p.platform}><Plug size={14} /> Use demo connection</Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI PROVIDERS + ROUTER TEST
// ---------------------------------------------------------------------------

interface ProviderInfo {
  id: string;
  name: string;
  description: string | null;
  authMethod: string;
  baseUrl: string | null;
  modalities: string[];
  freeTier: boolean;
  enabled: boolean;
  priority: number;
  hasKey: boolean;
}

interface ProbeRow {
  providerId: string;
  providerName: string;
  ok: boolean;
  message?: string;
}

export function ProvidersSettings() {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [usage, setUsage] = useState<Array<{ day: string; provider_id: string; modality: string; requests: number; errors: number }> | null>(null);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [probeBusy, setProbeBusy] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ modality: string; chain: ProbeRow[]; verdict: string; note?: string } | null>(null);

  const load = useCallback(async () => {
    const d = await api.get<{ providers: ProviderInfo[] }>('/admin/providers');
    setProviders(d.providers);
    api.get<{ usage: Array<{ day: string; provider_id: string; modality: string; requests: number; errors: number }> }>('/admin/usage?days=7')
      .then((u) => setUsage(u.usage))
      .catch(() => undefined);
  }, []);
  useEffect(() => { load().catch((e) => setError({ message: e.message })); }, [load]);

  async function toggle(p: ProviderInfo, enabled: boolean) {
    await api.put(`/admin/providers/${p.id}`, { enabled });
    await load();
  }
  async function setPriority(p: ProviderInfo, priority: number) {
    await api.put(`/admin/providers/${p.id}`, { priority });
    await load();
  }
  async function saveKey(p: ProviderInfo) {
    const key = keys[p.id];
    if (!key) return;
    setBusyKey(p.id);
    try {
      await api.put(`/admin/providers/${p.id}/key`, { key });
      setKeys({ ...keys, [p.id]: '' });
      await load();
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
    setBusyKey(null);
  }
  async function removeKey(p: ProviderInfo) {
    await api.del(`/admin/providers/${p.id}/key`);
    await load();
  }

  async function runProbe(modality: string) {
    setProbeBusy(modality);
    setProbe(null);
    try {
      const d = await api.post<{ modality: string; chain: ProbeRow[]; verdict: string; note?: string }>('/admin/router/test', { modality });
      setProbe(d);
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
    setProbeBusy(null);
  }

  return (
    <div className="space-y-5">
      <div className="card card-pad bg-gradient-to-br from-brand-400/10 to-transparent">
        <h2 className="font-bold text-white">AI provider router</h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-100/60">
          Providers are interchangeable behind one interface (<code className="rounded bg-white/10 px-1">generateText / generateImage / generateSpeech / generateVideo</code>).
          Keys are encrypted at rest. The router follows priority order, skips providers without the capability you need, and falls through automatically on failures.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['text', 'image', 'speech', 'video'] as const).map((m) => (
            <Button key={m} onClick={() => runProbe(m)} loading={probeBusy === m} className="px-3 py-1.5 text-xs"><Zap size={12} /> Test {m}</Button>
          ))}
          <span className="text-[11px] self-center text-brand-100/40">opens the exact fallback chain used during generation</span>
        </div>
      </div>

      {probe && (
        <div className="card card-pad animate-fadeUp">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-white">Router probe — {probe.modality}</span>
            <Badge tone={probe.verdict === 'all-failed' ? 'err' : probe.verdict === 'slideshow-fallback' ? 'warn' : 'ok'}>{probe.verdict}</Badge>
          </div>
          <ol className="space-y-1.5">
            {probe.chain.map((c, i) => (
              <li key={c.providerId + i} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-sm">
                <span className="text-[10px] font-bold text-brand-100/40">#{i + 1}</span>
                <span className="w-32 truncate font-semibold text-brand-100">{c.providerName}</span>
                {c.ok ? <Badge tone="ok"><Check size={10} /> routed</Badge> : <Badge tone="err">skipped</Badge>}
                <span className="ml-auto text-xs text-brand-100/55">{c.message ?? ''}</span>
              </li>
            ))}
          </ol>
          {probe.note && <p className="mt-2 text-xs text-brand-100/50">{probe.note}</p>}
        </div>
      )}

      {error && <FriendlyError error={error} />}

      <div className="card overflow-hidden">
        <div className="border-b border-white/10 px-5 py-3.5">
          <h3 className="text-sm font-bold text-white">Provider registry</h3>
        </div>
        <div className="divide-y divide-white/5">
          {providers?.map((p) => (
            <div key={p.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className={`rounded-lg p-2 ${p.hasKey ? 'bg-brand-400/15' : 'bg-white/5'}`}>
                  <KeyRound size={16} className={p.hasKey ? 'text-brand-300' : 'text-brand-100/30'} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{p.name}</span>
                    {p.freeTier && <Badge>free tier</Badge>}
                    {p.id === 'mock' && <Badge tone="brand">local demo</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-brand-100/50">
                    {p.modalities.map((m) => <span key={m} className="chip">{m}</span>)}
                    <span className="self-center opacity-60">{p.baseUrl}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {p.id !== 'mock' && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-brand-100/60">
                      <input type="number" className="input w-16 py-1 text-center" min={0} max={999} value={p.priority}
                        onChange={(e) => setPriority(p, Number(e.target.value))} title="priority (lower = tried first)" />
                    </label>
                  )}
                  <button
                    onClick={() => toggle(p, !p.enabled)}
                    className={`relative h-6 w-11 rounded-full transition ${p.enabled ? 'bg-brand-400' : 'bg-white/10'}`}
                    aria-label={p.enabled ? 'disable provider' : 'enable provider'}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${p.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
              {p.id !== 'mock' && (
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-10">
                  <div className="relative">
                    <input
                      type={showKey[p.id] ? 'text' : 'password'}
                      className="input w-64 py-1.5 pr-8 text-xs font-mono"
                      placeholder={p.hasKey ? '••••••••  (replace key)' : 'Paste API key…'}
                      value={keys[p.id] ?? ''}
                      onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
                    />
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-100/40 hover:text-brand-100" onClick={() => setShowKey({ ...showKey, [p.id]: !showKey[p.id] })}>
                      {showKey[p.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <Button className="px-3 py-1.5 text-xs" onClick={() => saveKey(p)} loading={busyKey === p.id} disabled={!keys[p.id]}>
                    <ShieldCheck size={12} /> {p.hasKey ? 'Update key' : 'Save key'}
                  </Button>
                  {p.hasKey && (
                    <Button className="px-3 py-1.5 text-xs" onClick={() => removeKey(p)}><Trash2 size={12} /> Remove</Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="mb-3 text-sm font-bold text-white">Usage this week (per provider / day)</h3>
        {usage && usage.length === 0 && <p className="text-sm text-brand-100/40">No generation calls recorded yet — run the router test above or generate a project.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-brand-100/40">
                <th className="pb-2 pr-4">Day</th><th className="pb-2 pr-4">Provider</th><th className="pb-2 pr-4">Modality</th><th className="pb-2 pr-4">Requests</th><th className="pb-2">Failures</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-brand-100/80">
              {usage?.slice(0, 40).map((u) => (
                <tr key={u.day + u.provider_id + u.modality}>
                  <td className="py-2 pr-4">{u.day}</td>
                  <td className="py-2 pr-4 font-medium text-white">{u.provider_id}</td>
                  <td className="py-2 pr-4">{u.modality}</td>
                  <td className="py-2 pr-4">{u.requests}</td>
                  <td className="py-2">{u.errors > 0 ? <span className="text-rose-300">{u.errors}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-brand-100/40">Usage tracking is what lets the router skip providers near their free-tier quota mid-pipeline.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// STYLE PRESETS (library)
// ---------------------------------------------------------------------------

interface StylePreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  visualStyle: string;
  colorPalette: string;
  captionStyle: string;
  tone: string;
  musicMood?: string | null;
  swatches: string[];
}

export function PresetsSettings() {
  const [presets, setPresets] = useState<StylePreset[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', visualStyle: '', tone: '', colorPalette: '', captionStyle: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; suggestion?: string } | null>(null);

  const load = useCallback(async () => {
    const d = await api.get<{ presets: StylePreset[] }>('/style-presets');
    setPresets(d.presets);
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  async function create() {
    setBusy(true);
    try {
      await api.post('/style-presets', {
        name: form.name, description: form.description, visualStyle: form.visualStyle,
        colorPalette: form.colorPalette || 'custom palette', captionStyle: form.captionStyle || 'Bold white caps on dark box',
        tone: form.tone || 'warm, direct', musicMood: 'ambient',
      });
      setForm({ name: '', description: '', visualStyle: '', tone: '', colorPalette: '', captionStyle: '' });
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError({ message: e.message, suggestion: e.suggestion });
    }
    setBusy(false);
  }

  async function remove(id: string) {
    await api.del(`/style-presets/${id}`);
    await load();
  }

  return (
    <div className="space-y-5">
      <div className="card card-pad bg-gradient-to-br from-brand-400/10 to-transparent">
        <h2 className="font-bold text-white">Style presets</h2>
        <p className="mt-1 max-w-2xl text-sm text-brand-100/60">
          Presets are appended to every generation prompt automatically — visual style, palette, caption font/color and tone.
          Built-ins ship with CAS; custom presets are yours (reference-image uploads land here later).
        </p>
        <div className="mt-3"><Button variant="primary" onClick={() => setShowForm((v) => !v)}><Plus size={15} /> New custom preset</Button></div>
      </div>

      {showForm && (
        <div className="card card-pad animate-fadeUp space-y-3">
          <h3 className="text-sm font-bold text-white">Describe your look</h3>
          {error && <FriendlyError error={error} />}
          <div className="grid gap-3 md:grid-cols-2">
            <input className="input" placeholder="Preset name — e.g. “Warm film grain”" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Tone — e.g. warm, playful, expert" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} />
          </div>
          <textarea className="input min-h-[60px]" placeholder="Visual style — e.g. grainy 16mm film look, soft window light, muted greens" value={form.visualStyle} onChange={(e) => setForm({ ...form, visualStyle: e.target.value })} />
          <div className="grid gap-3 md:grid-cols-2">
            <input className="input" placeholder="Color palette — e.g. olive, cream, rust" value={form.colorPalette} onChange={(e) => setForm({ ...form, colorPalette: e.target.value })} />
            <input className="input" placeholder="Caption style — e.g. rounded caps, cream box" value={form.captionStyle} onChange={(e) => setForm({ ...form, captionStyle: e.target.value })} />
          </div>
          <input className="input" placeholder="Description (shown in the gallery)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} loading={busy} disabled={!form.name || !form.visualStyle}>Save preset</Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {presets?.map((p) => (
          <div key={p.id} className="card card-pad group relative overflow-hidden">
            <div className="mb-3 h-16 overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, ${p.swatches[0] ?? '#0b2e2a'}, ${p.swatches[1] ?? '#0f4c44'})` }}>
              <div className="flex h-full items-center justify-center gap-1.5 opacity-90">
                {p.swatches.map((c) => <span key={c} className="h-5 w-5 rounded-full border border-white/30" style={{ background: c }} />)}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-white">{p.name}</h3>
              {p.builtIn ? <Badge>built-in</Badge> : <Badge tone="brand">yours</Badge>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-brand-100/55">{p.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-brand-100/45">
              <span className="chip">{p.captionStyle.length > 38 ? p.captionStyle.slice(0, 38) + '…' : p.captionStyle}</span>
              <span className="chip">{p.tone}</span>
            </div>
            {!p.builtIn && (
              <button onClick={() => remove(p.id)} className="absolute right-2 top-2 rounded-lg bg-black/40 p-1.5 text-brand-100/50 opacity-0 transition hover:text-rose-300 group-hover:opacity-100">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {presets && presets.length === 0 && <EmptyState icon={<Plus size={26} />} title="No presets yet" body="Create a custom preset — its style parameters will be appended to prompts automatically." />}
    </div>
  );
}
