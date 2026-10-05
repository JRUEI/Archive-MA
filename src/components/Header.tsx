'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useHydrated } from '@/lib/client-state';

export default function Header() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useHydrated();
  const isDark = resolvedTheme === 'dark';

  return (
    <nav className="w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 md:h-16 flex items-center justify-between">
        <Link href="/" className="text-xl md:text-2xl font-black tracking-tight transition-opacity hover:opacity-80">
          <span className="text-accent">My</span>
          <span className="text-zinc-900 dark:text-white">Arc</span>
        </Link>

        <button
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
          title={mounted ? (isDark ? "切換亮色" : "切換深色") : "切換主題"}
          aria-label="切換主題"
        >
          {mounted && (isDark ? <Sun size={18} /> : <Moon size={18} />)}
        </button>
      </div>
    </nav>
  );
}
