import type { Metadata, Viewport } from 'next';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Content Automation Studio',
  description: 'From prompt to published video across YouTube, TikTok, Instagram & Facebook — AI generation, editing and cross-platform monitoring in one loop.',
  icons: '/favicon.svg',
};

export const viewport: Viewport = {
  themeColor: '#061f22',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-brand-950 text-brand-50">
        <div className="pointer-events-none fixed inset-0 opacity-60 [background:radial-gradient(60rem_40rem_at_80%_-10%,rgba(44,180,156,.14),transparent),radial-gradient(50rem_30rem_at_-10%_20%,rgba(15,92,104,.18),transparent)]" />
        <div className="relative">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
