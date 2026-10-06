// 把太長的逐字稿行切短：node scripts/split-long-lines.mjs [檔名.md ...]（不給檔名＝content/videos 全部）
// 在 。？！ 切、還太長再在 ，、 切，切好的小段依字數比例分攤原本那一行的時間，字一個都不會少。
// 時間窗 = 到下一行的間隔，但最多照每秒 4 字算（間隔很長多半是靜音，不要把字幕拉太散）。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX = 28;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "videos");
const LINE = /^\[(\d{2}):(\d{2})(?:\.(\d))?\]\s*(.+)$/;

const secs = (m) => Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 10;
const stamp = (t) => {
  const d = Math.round(t * 10);
  return `[${String(Math.floor(d / 600)).padStart(2, "0")}:${String(Math.floor(d / 10) % 60).padStart(2, "0")}.${d % 10}]`;
};
const cut = (s, re) => s.match(new RegExp(`.+?(?:${re}|$)`, "g")).filter(Boolean);

// 先照句號切；仍超過 MAX 的再照逗號切；最後把相鄰小段併回不超過 MAX
export function split(text) {
  const parts = cut(text, "[。？！]+").flatMap((p) => (p.length > MAX ? cut(p, "[，、]+") : [p]));
  const out = [];
  for (const p of parts) {
    if (out.length && out.at(-1).length + p.length <= MAX) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

const demo = "嗯。那這些孩子之後會變成怎樣呢？這之後會進入育成階段，現在待在放牧地的時間非常長，等到身體和心理成長到一定程度";
assert(split(demo).join("") === demo && split(demo).every((p) => p.length <= MAX + 12), "split 自我檢查失敗");

const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
for (const f of files) {
  const file = path.isAbsolute(f) || fs.existsSync(f) ? f : path.join(dir, f);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const rows = lines.map((l, i) => ({ i, m: l.trim().match(LINE) }));
  const idx = rows.filter((r) => r.m).map((r) => r.i);
  let added = 0;
  const result = lines.slice();
  idx.forEach((li, k) => {
    const m = rows[li].m;
    const parts = split(m[4]);
    if (parts.length < 2) return;
    const start = secs(m);
    const gap = k + 1 < idx.length ? secs(rows[idx[k + 1]].m) - start : Infinity;
    const win = Math.min(gap, m[4].length / 4);
    let used = 0;
    result[li] = parts
      .map((p) => {
        const s = stamp(start + (win * used) / m[4].length);
        used += p.length;
        return `${s} ${p}`;
      })
      .join("\n");
    added += parts.length - 1;
  });
  fs.writeFileSync(file, result.join("\n"));
  console.log(`${path.basename(file)}：多切出 ${added} 行`);
}
