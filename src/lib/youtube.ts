// 前後端共用：不 import 任何東西，scripts 也可以直接載入

// 從 YouTube URL 提取 videoId
export function extractYouTubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v)\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/** 原影片封面。maxresdefault 不是每支都有，沒有時要退回 hqdefault */
export const thumbnailUrl = (id: string, quality: 'maxresdefault' | 'hqdefault' = 'maxresdefault') =>
  `https://i.ytimg.com/vi/${id}/${quality}.jpg`;
