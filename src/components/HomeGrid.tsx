'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { VideoListItem } from '@/lib/videos';
import { thumbnailUrl } from '@/lib/youtube';

const CHIP = 'shrink-0 px-3.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors';

export default function HomeGrid({ videos }: { videos: VideoListItem[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of videos) counts.set(v.folder, (counts.get(v.folder) ?? 0) + 1);
    return [...counts];
  }, [videos]);

  const requested = params.get('folder');
  // 網址裡的資料夾若不存在（被改名或打錯）就當作「全部」
  const current = folders.some(([name]) => name === requested) ? requested : null;
  const shown = current ? videos.filter((v) => v.folder === current) : videos;

  const select = (name: string | null) =>
    router.replace(name ? `/?folder=${encodeURIComponent(name)}` : '/', { scroll: false });

  const chip = (label: string, count: number, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      aria-pressed={active}
      className={`${CHIP} ${
        active
          ? 'bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900'
          : 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'
      }`}
    >
      {label} <span className="opacity-60">{count}</span>
    </button>
  );

  if (videos.length === 0) {
    return <p className="py-24 text-center text-zinc-500 dark:text-zinc-400">還沒有收藏的影片。把 YouTube 連結丟給 Claude 就會加進來。</p>;
  }

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4 -mx-6 px-6">
        {chip('全部', videos.length, current === null, () => select(null))}
        {folders.map(([name, count]) => chip(name, count, current === name, () => select(name)))}
      </div>

      <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((v) => (
          <Link key={v.id} href={`/videos/${v.id}`} className="group block">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element -- 外部圖床、靜態站不走 next/image */}
              <img
                src={thumbnailUrl(v.id)}
                alt=""
                loading="lazy"
                // 部分影片沒有 maxresdefault：失敗時換成 hqdefault，只換一次
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.dataset.fallback) {
                    img.dataset.fallback = '1';
                    img.src = thumbnailUrl(v.id, 'hqdefault');
                  }
                }}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
              <span className="absolute left-2 top-2 rounded-md bg-black/75 px-2 py-0.5 text-xs font-medium text-white">
                {v.folder}
              </span>
            </div>
            <h2 className="mt-3 line-clamp-2 text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-50 group-hover:text-link">
              {v.title}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {v.channel}
              {v.date && ` · ${v.date}`}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
