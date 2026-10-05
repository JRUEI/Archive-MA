import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getVideo } from '@/lib/videos';
import TranscriptMode from '@/components/TranscriptMode';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const video = getVideo((await params).id);
  return { title: video ? `${video.title} | MyArc` : 'MyArc' };
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const video = getVideo((await params).id);
  if (!video) notFound();

  return (
    <div className="max-w-6xl mx-auto px-6 pt-6 pb-12">
      <Link
        href={`/?folder=${encodeURIComponent(video.folder)}`}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-link mb-4"
      >
        <ArrowLeft size={16} />
        {video.folder}
      </Link>

      <header className="mb-5">
        <h1 className="text-xl sm:text-2xl font-bold leading-snug text-zinc-900 dark:text-zinc-50">{video.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{video.channel}</span>
          {video.date && <span>{video.date}</span>}
          <a
            href={video.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-link hover:underline underline-offset-4"
          >
            前往 YouTube <ExternalLink size={14} />
          </a>
        </p>
      </header>

      <TranscriptMode video={video} />
    </div>
  );
}
