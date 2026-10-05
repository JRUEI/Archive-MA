import { Suspense } from 'react';
import { getAllVideoListItems } from '@/lib/videos';
import HomeGrid from '@/components/HomeGrid';

export default function Home() {
  const videos = getAllVideoListItems();

  return (
    <div className="max-w-6xl mx-auto px-6 pt-6 sm:pt-8 pb-10 sm:pb-16">
      {/* HomeGrid 用 useSearchParams 讀 ?folder=，需要 Suspense */}
      <Suspense>
        <HomeGrid videos={videos} />
      </Suspense>
    </div>
  );
}
