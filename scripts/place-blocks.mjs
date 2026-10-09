// ⚠ 可疑併塊照音量手排時間（沒有 telop 可截圖時用；見 docs/translation-guidelines.md §4「怎麼校」）：
//   node scripts/place-blocks.mjs content/videos/<ID>.md <ID>.ja-orig.json3
//       列出每個 ⚠ 塊：日文、前一列在哪結束、要排的小段（已照 MAX 字硬切），最後印給 volume-probe.js 的量音量窗
//   node scripts/place-blocks.mjs content/videos/<ID>.md <ID>.ja-orig.json3 <spec.json> [--write]
//       照 spec 排時間、印結果（檢查不重疊、每段 ≥ 0.8 秒）；--write 寫回 md
// spec.json：{ "<塊起點，列表印的 key>": [起, 起, …, [起, 訖]] }，每個小段一個。數字一直顯示到下一段的起點；
//   [起, 訖] 提早結束（後面有停頓）；最後一段一定要 [起, 訖]。沒寫進 spec 的塊不動。
// 起點貼著下一個日文詞（差 ≤ 0.05 秒）的中文列屬於那個詞，不算這塊的。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LINE, MAX, bare, inBlock, isNote, loadSegs, sec, split, stamp, suspects } from './retime-subtitles.mjs';

// 一列切成 ≤ MAX 字的小段（標註行不切）；跟 retime 的硬切同一套切點
const pieces = (text) => {
  if (isNote(text) || bare(text) <= MAX) return [text];
  const out = [];
  for (const p of split(text)) if (out.length && bare(out.at(-1) + p) <= MAX) out[out.length - 1] += p; else out.push(p);
  return out;
};
const demo = '那個時候真的很緊張，腦袋一片空白，結果什麼都沒說出來。';
assert(pieces(demo).join('') === demo && pieces(demo).every((p) => bare(p) <= MAX), '小段接回去要是原句、每段不超過 MAX');

const [mdPath, jsonPath, specPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!mdPath || !jsonPath) throw new Error('用法：node scripts/place-blocks.mjs <影片.md> <ja-orig.json3> [spec.json [--write]]');
const raw = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
const lines = raw.flatMap((l, i) => {
  const m = l.trim().match(LINE);
  return m ? [{ i, t: sec(m[1], m[2]), e: m[3] && sec(m[3], m[4]), text: m[5].trim() }] : [];
});
const spec = specPath ? JSON.parse(fs.readFileSync(specPath, 'utf8')) : null;
const wins = [], edits = [], skipped = [];

for (const b of suspects(loadSegs(jsonPath))) {
  const key = b.t.toFixed(2);
  const rows = lines.filter((l) => inBlock(b, l.t) && Math.abs(l.t - b.next) > 0.05);
  if (!rows.length) continue; // 這塊沒有中文（沒翻的閒聊）
  const before = lines[lines.indexOf(rows[0]) - 1];
  const nextT = lines[lines.indexOf(rows.at(-1)) + 1]?.t ?? Infinity;
  const ps = rows.flatMap((r) => pieces(r.text));
  if (!spec) {
    console.log(`\n${key}  ${stamp(b.t)}–${stamp(b.next)}${before?.e ? `，前一列 ${stamp(before.e)} 結束` : ''}，下一列 ${stamp(nextT)}`);
    console.log(`  日文 ${b.text.replace(/\n/g, '')}`);
    console.log(`  ${ps.length} 段：${ps.map((p) => `${p}(${bare(p)})`).join(' | ')}`);
    wins.push({ k: key, a: +(b.t - 2).toFixed(2), b: +(b.next + 2).toFixed(2) });
    continue;
  }
  const sp = spec[key];
  if (!sp) { skipped.push(key); continue; }
  assert.equal(sp.length, ps.length, `${key}：要 ${ps.length} 個時間`);
  assert(Array.isArray(sp.at(-1)), `${key}：最後一段要寫 [起, 訖]`);
  const out = ps.map((text, j) => {
    const x = sp[j], nx = sp[j + 1];
    return { text, s: Array.isArray(x) ? x[0] : x, e: Array.isArray(x) ? x[1] : Array.isArray(nx) ? nx[0] : nx };
  });
  if (before?.e) assert(out[0].s >= Math.round(before.e * 10) / 10 - 1e-9, `${key}：比前一列結束（${stamp(before.e)}）還早`);
  out.forEach((x, j) => assert(x.e - x.s >= 0.8 - 1e-9 && x.e <= (out[j + 1]?.s ?? nextT) + 1e-9, `${key} ${stamp(x.s)} ${x.text}：短於 0.8 秒或跟後面重疊`));
  console.log(`\n${key}（原本 ${rows.map((r) => `[${stamp(r.t)}-${r.e ? stamp(r.e) : ''}]`).join(' ')}）`);
  for (const x of out) console.log(`  [${stamp(x.s)}-${stamp(x.e)}] ${x.text}${bare(x.text) > MAX ? `   ← ${bare(x.text)} 字，沒有標點可切` : ''}`);
  assert.deepEqual(rows.map((r) => r.i), rows.map((_, k) => rows[0].i + k), `${key}：中文列中間夾了別的行`);
  edits.push({ from: rows[0].i, n: rows.length, text: out.map((x) => `[${stamp(x.s)}-${stamp(x.e)}] ${x.text}`) });
}

if (!spec) console.log(`\n量音量的窗（貼給 volume-probe.js 的 __run）：\n${JSON.stringify(wins)}`);
if (skipped.length) console.log(`\nspec 沒寫、沒動：${skipped.join(' ')}`);
if (spec && process.argv.includes('--write')) {
  for (const e of edits.sort((a, b) => b.from - a.from)) raw.splice(e.from, e.n, ...e.text);
  fs.writeFileSync(mdPath, raw.join('\n'));
  console.log(`\n寫回 ${mdPath}：${edits.length} 塊`);
}
