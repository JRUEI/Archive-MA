import 'server-only';

import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const videosDirectory = path.join(process.cwd(), 'content', 'videos');

export interface TranscriptLine {
  /** 顯示與跳轉用的 mm:ss，不帶小數 */
  time: string;
  /** 檔案裡的時間（可到 0.1 秒），字幕疊層與播放同步看這個 */
  seconds: number;
  text: string;
}

export interface VideoListItem {
  id: string;
  title: string;
  channel: string;
  folder: string;
  date: string;
}

export interface VideoData extends VideoListItem {
  youtubeUrl: string;
  transcript: TranscriptLine[];
}

// [mm:ss.d]：小數可有可無，time 只取整秒那段
const LINE = /^\[((\d{2}:\d{2}(?::\d{2})?)(?:\.\d)?)\]\s*(.+)$/;
const toSeconds = (time: string) => time.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);

function videoFileNames() {
  if (!fs.existsSync(videosDirectory)) return [];
  return fs.readdirSync(videosDirectory).filter((fileName) => fileName.endsWith('.md'));
}

export function getAllVideoIds() {
  return videoFileNames().map((fileName) => fileName.replace(/\.md$/, ''));
}

export function getVideo(id: string): VideoData | null {
  const fullPath = path.join(videosDirectory, `${id}.md`);
  if (!fs.existsSync(fullPath)) return null;
  const { data, content } = matter(fs.readFileSync(fullPath, 'utf8'));

  const transcript: TranscriptLine[] = [];
  for (const line of content.split('\n')) {
    const match = line.trim().match(LINE);
    if (match) transcript.push({ time: match[2], seconds: toSeconds(match[1]), text: match[3] });
  }

  return {
    id,
    title: data.title || '',
    channel: data.channel || '',
    folder: data.folder || '',
    date: data.date instanceof Date ? data.date.toISOString().split('T')[0] : String(data.date ?? ''),
    youtubeUrl: data.youtube || '',
    transcript,
  };
}

/** 新到舊 */
export function getAllVideoListItems(): VideoListItem[] {
  return getAllVideoIds()
    .map((id) => getVideo(id))
    .filter((video): video is VideoData => video !== null)
    .map(({ id, title, channel, folder, date }) => ({ id, title, channel, folder, date }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
