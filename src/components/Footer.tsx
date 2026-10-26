export default function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="max-w-6xl mx-auto px-6 py-8 text-sm text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <span>MyArc · 個人收藏的熟肉（中文字幕）影片。影片與封面版權屬原作者，本站僅內嵌 YouTube 播放。</span>
        <a
          href="https://github.com/JRUEI/Archive-MA/actions"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 underline-offset-4 hover:underline hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          部署狀態
        </a>
      </div>
    </footer>
  );
}
