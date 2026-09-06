'use client';

import { ProvidersSettings, SettingsTabs } from '@/components/settings';

export default function ProvidersPage() {
  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-brand-100/60">Channels, AI providers & style presets</p>
        </div>
        <SettingsTabs active="providers" />
      </div>
      <ProvidersSettings />
    </div>
  );
}
