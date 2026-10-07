// 用 YouTube 日文自動字幕（每個詞／句有起點）替中文字幕算出「實際說話的起訖」：
//   node scripts/retime-subtitles.mjs content/videos/<ID>.md <ID>.ja-orig.json3 [--dry | --scan]
// 日文檔：yt-dlp --skip-download --write-auto-subs --sub-langs ja-orig --sub-format json3 -o "%(id)s" <影片網址>
// 輸入是只有起點的逐字稿 [mm:ss.d] 中文；輸出 [起-訖] 中文。字一個都不改，--dry 只印報告不寫檔。
// --scan：只檢查「可疑併塊」（見 suspects），已校時的稿也能跑，不改檔。有 ⚠ 的地方起點不可信，上線前要對畫面／聽音檔。
//
// 1. 太長的行（> MAX 字）在 。？！ 切，不夠再在 ，、 切
// 2. 切點對到日文：先依字數比例估時間，再貼到附近的日文標點／停頓
// 3. 每行結束 = 日文說話結束 + 餘韻，至少夠讀完；放不下就讓下一行晚一點出現（最多 MAXLAG 秒）
//    說話結束 = 連續在說的那段日文的結尾；停頓 > PAUSE 且已說夠字數，後面沒翻的附和就不拉長這一行
// 4. （笑）之類的標註行不蓋掉還沒說完的話：等前一句說完才出現，也不拖慢後面的話
// 起點對得上日文 seg 開頭的行當「錨點」保持原樣；對不上的（同時間的重複行、手估的續行）併進前一個錨點重新分配。
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ── 校準用的常數（時間不對就先動這裡）──
const MAX = 28; //       一行最多幾個字
const POS = 0.15; //     日文每字幾秒，算「切點在哪」用。取偏快：字幕寧可早一點出現，不要晚
const SPC = 0.19; //     日文每字幾秒，算「說完了沒」用。實測中位數 0.16，取偏慢：寧可多留，不要話沒說完就收
const LINGER = 0.4; //   說完後多留幾秒
const CPS = 6.5; //      舒適閱讀速度（字／秒）
const CPS_MAX = 9; //    再快就太趕，才向下一行借時間
const MIN_DUR = 1.5; //  再短的字幕也至少留這麼久
const MIN_ABS = 0.8; //  再擠也不能短於這個（一般字幕規範的下限約 0.83 秒）
const MIN_ANN = 0.8; //  （笑）這類標註至少留這麼久（擠不出來就算了，不拖慢說話）
const MAXLAG = 1.0; //   借時間時，下一行最多晚出現幾秒
const FLICKER = 0.3; //  兩行間隔小於這個就接起來，不閃
const TOL = 0.25; //     中文行起點與日文 seg 起點最多差幾秒還算「對得上」（手估的行常差 0.1–0.2）
const SNAP = 1.5; //     切點最多往日文標點／停頓靠幾秒
const PAUSE = 1.2; //    日文停頓超過這麼久，後面接著說的話不算這一行的（多半是沒翻的附和／另一句），不拿來拉長這一行
const COVER = 1.2; //    但停頓前已說的日文字數要 ≥ 這行中文字數 × COVER 才算斷（日文／中文字數比中位數 1.4，1.2 約第 25 百分位）；不夠多半是自動字幕漏了幾個詞
const SLACK = 5; //      併塊的起點到下一個詞之間，扣掉照 POS 語速說完所需時間後還剩幾秒以上，就算起點可疑
const MIN_CHUNK = 15; // 太短的 seg（「はい」）起點多半是對的，不查
const GAP = 0.3; //      相鄰兩行起點至少隔幾秒

const jlen = (s) => s.replace(/\[[^\]]*\]|[\s。、，！？!?.,…]/g, '').length; // [音楽] 之類不算字
const clen = (s) => s.replace(/\s/g, '').length;
const isNote = (s) => /^[（(][^（）()]*[）)]$/.test(s); // （笑）、（尖叫聲）：整行都是標註，沒有對應的日文
const need = (c) => Math.max(MIN_DUR, 0.6 + c / CPS);
const must = (c) => Math.max(MIN_ABS, 0.4 + c / CPS_MAX);

const LINE = /^\[(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d))?(-\d{2}:\d{2}(?::\d{2})?(?:\.\d)?)?\]\s*(.+)$/;
const sec = (hms, d) => hms.split(':').reduce((a, n) => a * 60 + Number(n), 0) + Number(d ?? 0) / 10;
const stamp = (t) => {
  const d = Math.round(t * 10);
  const s = Math.floor(d / 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${s >= 3600 ? `${pad(Math.floor(s / 3600))}:` : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${d % 10}`;
};

// ── 切行：。？！ → ，、 → 併回不超過 MAX ──
const cut = (s, re) => s.match(new RegExp(`.+?(?:${re}|$)`, 'g')).filter(Boolean);
export function split(text) {
  const parts = cut(text, '[。？！]+').flatMap((p) => (p.length > MAX ? cut(p, '[，、]+') : [p]));
  const out = [];
  for (const p of parts) {
    if (out.length && out.at(-1).length + p.length <= MAX) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

// ── 日文：每個 seg 依標點切成「子句」，子句時間在 seg 內依字數均分。
//    t,e = 子句起訖（POS 語速）；fin = 估計的說完時間（SPC 語速，只有 seg 的最後一個子句比 e 晚）──
export function atomsOf(segs) {
  const atoms = [];
  segs.forEach((sg, i) => {
    const fin = Math.min(segs[i + 1]?.t ?? Infinity, sg.t + sg.n * SPC);
    const end = Math.min(fin, sg.t + sg.n * POS);
    let cum = 0;
    for (const part of sg.text.match(/[^。、！？!?]+[。、！？!?]*/g) ?? []) {
      const n = jlen(part);
      if (!n) continue;
      const e = sg.t + ((end - sg.t) * (cum + n)) / sg.n;
      atoms.push({
        t: sg.t + ((end - sg.t) * cum) / sg.n,
        e,
        fin: cum + n === sg.n ? fin : e,
        n,
        head: cum === 0, //                                     seg 的第一個子句：中文行的起點會對在這
        mark: /[。！？!?]$/.test(part) ? 2 : /、$/.test(part) ? 1 : 0, // 句尾標點的強度
      });
      cum += n;
    }
  });
  return atoms;
}

const loadSegs = (file) =>
  JSON.parse(fs.readFileSync(file, 'utf8')).events.flatMap((ev) =>
    (ev.segs ?? []).map((sg) => ({ t: (ev.tStartMs + (sg.tOffsetMs ?? 0)) / 1000, text: sg.utf8 ?? '', n: jlen(sg.utf8 ?? '') })),
  ).filter((sg) => sg.n);

// 可疑併塊：自動字幕有時把一長段話併成一個 seg，起點只是「前一個辨識到的聲音」之後，真正開口可能晚很多
// （BTraK6PHUp0 36:26.8：現場在笑，受訪旁白 36:40 才開始，整段中文早了 12 秒）。
// 說話落在 [起點, 下一個詞) 這段空檔的哪裡無從得知，只能標出來叫人去對畫面。
export const suspects = (segs) =>
  segs.flatMap((s, i) => {
    const next = segs[i + 1]?.t;
    const slack = next === undefined ? 0 : next - s.t - s.n * POS;
    return s.n >= MIN_CHUNK && slack > SLACK ? [{ ...s, next, slack }] : [];
  });

// 一個 chunk = 一個錨點行＋緊接著對不上日文的續行。回傳每個小段的 {S 起, E 說完}
function place(pieces, anchorT, spanEnd, atoms) {
  const C = pieces.reduce((a, p) => a + p.c, 0);
  if (!atoms.length) { // 這段日文抓不到字：照中文字數，每秒 4 字
    const win = Math.min(spanEnd - anchorT, C / 4);
    let used = 0;
    return pieces.map((p) => {
      const S = anchorT + (win * used) / C;
      used += p.c;
      return { S, E: S + p.c / 6 };
    });
  }
  const N = atoms.reduce((a, x) => a + x.n, 0);
  let acc = 0;
  const G = atoms.map((x) => { const g = acc / N; acc += x.n; return g; }); // 各子句開頭已說了幾成
  const timeAt = (F) => {
    const k = Math.max(0, G.findLastIndex((g) => g <= F + 1e-9));
    return atoms[k].t + ((F - G[k]) / (atoms[k].n / N)) * (atoms[k].e - atoms[k].t);
  };

  const S = [anchorT];
  let used = pieces[0].c;
  for (let j = 1; j < pieces.length; used += pieces[j++].c) {
    const T = timeAt(used / C);
    const floor = S[j - 1] + GAP;
    let best = { t: Math.max(T, floor), cost: 0 }; // 沒有適合貼的標點／停頓就用比例估的
    atoms.forEach((a, k) => {
      if (k === 0 || a.t < floor || Math.abs(a.t - T) > SNAP) return;
      const prev = atoms[k - 1];
      const bonus = [0, 0.4, 0.8][prev.mark] + 0.6 * Math.min(1, Math.max(0, a.t - prev.fin)); // 句尾比逗號好，真的停頓更好
      const cost = Math.abs(a.t - T) - bonus;
      if (cost < best.cost) best = { t: a.t, cost };
    });
    S.push(best.t);
  }
  // 說完 = 從 s 起「連續在說」的那一段日文的結尾，不超過下一小段的起點 L
  const runEnd = (s, L, c) => {
    let k = atoms.findIndex((a) => a.fin > s + 1e-6);
    if (k < 0 || atoms[k].t >= L - 1e-6) return s;
    let n = atoms[k].n;
    while (atoms[k + 1] && atoms[k + 1].t < L - 1e-6 && (atoms[k + 1].t - atoms[k].fin <= PAUSE || n < c * COVER)) n += atoms[++k].n;
    return Math.max(s, Math.min(L, atoms[k].fin));
  };
  return S.map((s, j) => ({ S: s, E: runEnd(s, S[j + 1] ?? Infinity, pieces[j].c) }));
}

// ── 主流程：lines = [{t, text}]（起點遞增）→ pieces = [{text, c, S, E, s, e}]；s,e 是最後要顯示的起訖 ──
export function retime(lines, atoms) {
  const heads = atoms.filter((a) => a.head).map((a) => a.t);
  const talk = lines.filter((l) => !isNote(l.text));
  // 錨點：起點對得上某個日文 seg 開頭、且比上一個錨點晚的行；起點改成那個 seg 的開頭
  const anchors = [];
  talk.forEach((l, i) => {
    const h = heads.reduce((b, x) => (Math.abs(x - l.t) < Math.abs(b - l.t) ? x : b), Infinity);
    const ok = Math.abs(h - l.t) <= TOL;
    if (i === 0) anchors.push({ i, T: ok ? h : l.t });
    else if (ok && h > anchors.at(-1).T + 1e-6) anchors.push({ i, T: h });
  });

  const pieces = [];
  anchors.forEach(({ i, T }, ci) => {
    const next = anchors[ci + 1];
    const mine = talk.slice(i, next?.i ?? talk.length).flatMap((l) => split(l.text)).map((text) => ({ text, c: clen(text) }));
    const inSpan = atoms.filter((a) => a.t >= T - 1e-6 && a.t < (next?.T ?? Infinity) - 1e-6);
    place(mine, T, next?.T ?? Infinity, inSpan).forEach((p, j) => pieces.push({ ...mine[j], ...p }));
  });
  for (const l of lines.filter((l) => isNote(l.text))) pieces.push({ text: l.text, c: clen(l.text), S: l.t, E: l.t, note: true });
  pieces.sort((a, b) => a.S - b.S);

  // 標註（笑）等：等前一句說完才出現，但留 MIN_ANN 給自己，前一句也至少讀得完
  pieces.forEach((p, j) => {
    if (!p.note) return;
    const prev = pieces[j - 1], next = pieces[j + 1];
    let S = Math.max(p.S, prev?.E ?? -Infinity);
    S = Math.max(Math.min(S, next ? next.S - MIN_ANN : Infinity), prev ? prev.S + must(prev.c) : -Infinity);
    p.S = p.E = Math.min(S, next ? next.S - GAP : Infinity);
  });

  // 排時間：結束 = 說完 + 餘韻，至少夠讀，但不蓋到下一行；放不下時貼到下一行起點，
  // 連 must 都不到才讓下一行晚一點出現（借時間；標註不借，不拖慢說話）
  pieces.forEach((p) => { p.s = p.S; });
  pieces.forEach((p, j) => {
    const next = pieces[j + 1];
    const limit = next ? next.S : Infinity;
    const want = Math.max(p.E + LINGER, p.s + need(p.c));
    if (want <= limit) {
      p.e = limit - want < FLICKER ? limit : want;
      return;
    }
    const slack = (pieces[j + 2]?.S ?? Infinity) - limit - must(next.c); // 下一行最多還能晚多少，仍然夠它自己讀
    const lag = p.note ? 0 : Math.max(0, Math.min(p.s + must(p.c) - limit, MAXLAG, slack));
    next.s = limit + lag;
    p.e = limit + lag;
  });

  pieces.forEach((p, j) => { // 一閃而過的（「好」「嗯」夾在兩句中間）：向前一行要一點，前一行至少保留 must
    const prev = pieces[j - 1];
    const take = prev ? Math.min(MIN_ABS - (p.e - p.s), prev.e - prev.s - must(prev.c)) : 0;
    if (take > 0) { p.s -= take; prev.e -= take; }
  });

  for (const p of pieces) { p.s = Math.round(p.s * 10) / 10; p.e = Math.round(p.e * 10) / 10; }
  pieces.forEach((p, j) => {
    if (pieces[j + 1]) p.e = Math.min(p.e, pieces[j + 1].s);
    assert(p.e > p.s, `時間排壞了：${stamp(p.s)}-${stamp(p.e)} ${p.text}`);
  });
  return pieces;
}

// ── 自我檢查：切行不掉字、起訖單調、（笑）不蓋掉還沒說完的話 ──
{
  const demo = '嗯。那這些孩子之後會變成怎樣呢？這之後會進入育成階段，現在待在放牧地的時間非常長，等到身體和心理成長到一定程度';
  assert(split(demo).join('') === demo && split(demo).every((p) => p.length <= MAX + 12), 'split 自我檢查失敗');
  const segs = [{ t: 10, text: 'ながいぶんしょう、にたいへんながい、ぶんしょうです。' }, { t: 20, text: 'つぎのぶんです。' }].map((s) => ({ ...s, n: jlen(s.text) }));
  const out = retime([{ t: 10, text: '很長的句子，還有後半。' }, { t: 11, text: '（笑）' }, { t: 20, text: '下一句。' }], atomsOf(segs));
  assert(out.map((p) => p.text).join('|') === '很長的句子，還有後半。|（笑）|下一句。', '順序錯了');
  assert(out[0].s === 10 && out[1].s > 11 && out[1].s >= 10 + 22 * POS && out[2].s === 20, '（笑）應等前一句說完才出現');
  assert(out.every((p, j) => p.e > p.s && (!out[j + 1] || p.e <= out[j + 1].s)), '起訖不單調');
  const sus = suspects([{ t: 0, n: 98 }, { t: 30, n: 3 }, { t: 33, n: 40 }, { t: 40, n: 3 }].map((x) => ({ text: '', ...x })));
  assert(sus.length === 1 && sus[0].t === 0, '可疑併塊：98 字佔 30 秒要標，40 字佔 7 秒不標');
}

if (process.argv[1]?.endsWith('retime-subtitles.mjs')) {
  const [mdPath, jsonPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!mdPath || !jsonPath) throw new Error('用法：node scripts/retime-subtitles.mjs <影片.md> <ja-orig.json3> [--dry | --scan]');
  const raw = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const hit = raw.map((l, i) => ({ i, m: l.trim().match(LINE) })).filter((r) => r.m);
  assert(hit.length, '找不到 [mm:ss.d] 逐字稿行');
  const lines = hit.map(({ m }) => ({ t: sec(m[1], m[2]), text: m[4].trim() }));
  const segs = loadSegs(jsonPath);

  const sus = suspects(segs);
  for (const s of sus) {
    const mine = lines.filter((l) => l.t >= s.t - 0.5 && l.t < s.next);
    console.log(`⚠ ${stamp(s.t)} 起一整塊 ${s.n} 字，${stamp(s.next)} 才有下一個詞（多出 ${s.slack.toFixed(0)} 秒空檔）：起點不可信；中文 ${mine.length} 行「${mine[0]?.text.slice(0, 12) ?? ''}…」→ 對畫面／聽音檔`);
  }
  console.log(sus.length ? `共 ${sus.length} 處可疑併塊` : '沒有可疑併塊');

  if (!process.argv.includes('--scan')) {
    assert(!hit.some(({ m }) => m[3]), '已經有 -訖 了（校時過）；請從只有起點的逐字稿重跑，例如 git 歷史裡的舊版（只想檢查可疑併塊就加 --scan）');
    const between = raw.slice(hit[0].i, hit.at(-1).i + 1).filter((l) => l.trim() && !LINE.test(l.trim()));
    assert(!between.length, `逐字稿中間夾了非時間行：${between[0]}`);

    const pieces = retime(lines, atomsOf(segs));
    // 標註（笑）可能被排到被切開的長行中間，所以對話文字與標註分開比
    const same = (xs, pick) => xs.filter(pick).map((x) => x.text).join('');
    assert(same(pieces, (p) => !p.note) === same(lines, (l) => !isNote(l.text)) && [...same(pieces, (p) => p.note)].sort().join('') === [...same(lines, (l) => isNote(l.text))].sort().join(''), '字被改到了');

    const lagged = pieces.filter((p) => p.s - p.S > 0.05);
    const fast = pieces.filter((p) => p.c / (p.e - p.s) > CPS_MAX);
    const tight = pieces.filter((p) => p.note && p.e - p.s < MIN_ANN - 0.01);
    console.log(`${lines.length} 行 → ${pieces.length} 行；晚出現 ${lagged.length} 行（最多 ${Math.max(0, ...lagged.map((p) => p.s - p.S)).toFixed(1)} 秒）；讀太快（> ${CPS_MAX} 字/秒）${fast.length} 行；標註擠到不足 ${MIN_ANN} 秒 ${tight.length} 行`);
    for (const p of [...fast, ...tight]) console.log(`  ${stamp(p.s)}-${stamp(p.e)} ${p.text.slice(0, 30)}`);
    if (!process.argv.includes('--dry')) {
      const body = pieces.map((p) => `[${stamp(p.s)}-${stamp(p.e)}] ${p.text}`);
      fs.writeFileSync(mdPath, [...raw.slice(0, hit[0].i), ...body, ...raw.slice(hit.at(-1).i + 1)].join('\n'));
    }
  }
}
