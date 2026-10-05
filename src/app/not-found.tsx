import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-accent/30 mb-4">404</div>
        <h1 className="text-2xl font-bold mb-3 text-zinc-900 dark:text-zinc-100">找不到這個頁面</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mb-8 leading-relaxed">
          您要找的頁面可能已經被移除、名稱已經變更，或是暫時無法使用。
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-link text-white rounded-xl font-bold hover:opacity-90 transition-colors shadow-md"
        >
          返回首頁
        </Link>
      </div>
    </div>
  );
}
