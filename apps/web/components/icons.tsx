// ---------------------------------------------------------------------------
// CAS logomark (original design: play triangle + orbit ring, teal/dark-teal).
// ---------------------------------------------------------------------------
export function LogoSvg({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="Content Automation Studio">
      <defs>
        <linearGradient id="casLogoGradient" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2CB49C" />
          <stop offset="1" stopColor="#0F5C68" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="20" stroke="url(#casLogoGradient)" strokeWidth="3.4" opacity="0.9" />
      <circle cx="41" cy="13" r="3.4" fill="#FFE8A3" />
      <path d="M21 17.4 32.2 24 21 30.6V17.4Z" fill="url(#casLogoGradient)" stroke="#E9FAF6" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="12.4" stroke="#E9FAF6" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="2.6 5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Third-party platform icons — imported from the Simple Icons package, which
// tracks official brand marks (we do NOT hand-draw trademarked logos).
// https://simpleicons.org
// ---------------------------------------------------------------------------
import { siYoutube, siTiktok, siInstagram, siFacebook } from 'simple-icons';

export const BRAND_META: Record<string, { title: string; color: string; path: string }> = {
  youtube: { title: 'YouTube', color: `#${siYoutube.hex}`, path: siYoutube.path },
  tiktok: { title: 'TikTok', color: `#${siTiktok.hex}`, path: siTiktok.path },
  instagram: { title: 'Instagram', color: `#${siInstagram.hex}`, path: siInstagram.path },
  facebook: { title: 'Facebook', color: `#${siFacebook.hex}`, path: siFacebook.path },
};

export function BrandIcon({ platform, size = 20, className }: { platform: string; size?: number; className?: string }) {
  const meta = BRAND_META[platform];
  if (!meta) return <span style={{ width: size, height: size }} className="inline-block rounded bg-ink-soft/30" />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={meta.color} className={className} role="img" aria-label={meta.title}>
      <path d={meta.path} />
    </svg>
  );
}

export function brandColor(platform: string): string {
  return BRAND_META[platform]?.color ?? '#1f8a70';
}
