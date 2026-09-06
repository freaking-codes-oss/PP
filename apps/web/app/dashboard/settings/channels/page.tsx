'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChannelsSettings } from '@/components/settings';
import { SettingsTabs } from '@/components/settings';

export default function ChannelsPage() {
  const params = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (params.get('connected') === 'youtube') {
      setNotice('YouTube connected! Your channel token is stored encrypted.');
    }
  }, [params]);
  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-brand-100/60">Channels, AI providers & style presets</p>
        </div>
        <SettingsTabs active="channels" />
      </div>
      {notice && <div className="animate-fadeUp rounded-xl border border-brand-300/25 bg-brand-400/10 px-4 py-3 text-sm text-brand-100">✓ {notice}</div>}
      <ChannelsSettings />
    </div>
  );
}
