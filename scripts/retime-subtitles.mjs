// 用 YouTube 日文自動字幕（每個詞／句有起點）替中文字幕算出「實際說話的起訖」：
//   node scripts/retime-subtitles.mjs content/videos/<ID>.md <ID>.ja-orig.json3 [--dry | --scan | --resplit [--dry] | --table]
// 日文檔：yt-dlp --skip-download --write-auto-subs --sub-langs ja-orig --sub-format json3 -o "%(id)s" <影片網址>
//   （不加）   只有起點的逐字稿 [mm:ss.d] 中文 → [起-訖] 中文，字一個都不改。--dry 只印報告不寫檔
//   --scan     只檢查不改檔，已校時的稿也能跑：可疑併塊（見 suspects；有 ⚠ 的地方起點不可信，上線前要對畫面／聽音檔）、
//              行首孤立的語氣字（或整行只有標點）、太長的行、字數分布
//   --resplit  已校時的稿再切短：只動超過一列上限的行，每行起訖不動，在行內按規則 1 切（⚠ 併塊裡的行可能手校過，不動）。
//              切過的小段不再碰，重跑結果不變（5 支有日文字幕的影片實測）。加 --dry 只印報告
//   --table    給校稿用的對照表（只印不改）：每行中文配上同一段時間說的日文，標出估的時間、⚠、太長、孤立語氣字、
//              沒有日文的行，並插入沒落在任何一行裡的日文（可能漏翻）
// 每種模式都先印來源：逐字型（YouTube 給了每個詞的時間）或整塊型（只有區塊起點，切出來的新列起點多半是估的）。
//
// 1. 硬切（視覺優先）：長行先在 。？！（不夠再 ，、）切成 ≤ MAX 字的小段，時間對不到日文開口也切，整塊型一樣；
//    小段起點是估的、併回前一段又不超過 MAX 字（不算標點）才併回
// 2. 切點對到日文：先依字數比例估時間，再貼到附近的日文標點／停頓
// 3. 每行結束 = 日文說話結束 + 餘韻，至少夠讀完；放不下就讓下一行晚一點出現（最多 MAXLAG 秒）
//    說話結束 = 連續在說的那段日文的結尾；停頓 > PAUSE 且已說夠字數，後面沒翻的附和就不拉長這一行
// 4. （笑）之類的標註行不蓋掉還沒說完的話：等前一句說完才出現，也不拖慢後面的話
// 起點對得上日文 seg 開頭的行當「錨點」保持原樣；對不上的（同時間的重複行、手估的續行）併進前一個錨點重新分配。
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ── 校準用的常數（時間不對就先動這裡）──
export const MAX = 12; //       一列上限：長行切成幾個字以內的小段；--scan、--table 也拿它當「太長」
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
export const bare = (s) => s.replace(/[\s，。、？！；：…—「」『』（）()《》～・,.!?［］\[\]]/g, '').length; // 一列幾個字：標點不算
export const isNote = (s) => /^[（(][^（）()]*[）)]$/.test(s); // （笑）、（尖叫聲）：整行都是標註，沒有對應的日文
// 句尾語氣字或標點被擠到下一行開頭（應接回上一行）。不含「嘛」：行首「嘛，」是本站對まあ的譯法
const orphan = (s) => /^[呢吧嗎啦囉](?:[。？！，、…]|$)/.test(s) || !bare(s);
const need = (c) => Math.max(MIN_DUR, 0.6 + c / CPS);
const must = (c) => Math.max(MIN_ABS, 0.4 + c / CPS_MAX);
const onHead = (heads, t, tol = 0.05) => heads.some((h) => Math.abs(h - t) <= tol); // 時間貼著某個日文 seg 開頭（實測到的開口）

export const LINE = /^\[(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d))?(?:-(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d))?)?\]\s*(.+)$/;
export const sec = (hms, d) => hms.split(':').reduce((a, n) => a * 60 + Number(n), 0) + Number(d ?? 0) / 10;
export const stamp = (t) => {
  const d = Math.round(t * 10);
  const s = Math.floor(d / 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${s >= 3600 ? `${pad(Math.floor(s / 3600))}:` : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}.${d % 10}`;
};

// ── 切行：。？！ → ，、 → 併回不超過 MAX ──
const cut = (s, re) => s.match(new RegExp(`.+?(?:${re}|$)`, 'g')).filter(Boolean);
export function split(text) {
  const parts = cut(text, '[。？！]+[」』）)]*').flatMap((p) => (p.length > MAX ? cut(p, '[，、]+') : [p]));
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

export const loadSegs = (file) =>
  JSON.parse(fs.readFileSync(file, 'utf8')).events.flatMap((ev) =>
    (ev.segs ?? []).map((sg) => ({ t: (ev.tStartMs + (sg.tOffsetMs ?? 0)) / 1000, text: sg.utf8 ?? '', n: jlen(sg.utf8 ?? ''), off: sg.tOffsetMs !== undefined })),
  ).filter((sg) => sg.n);
// 逐字型：過半的 seg 有 tOffsetMs（YouTube 給了每個詞的時間，切點對得到開口）；整塊型：一個 event 一個 seg，只有區塊起點
export const isWordLevel = (segs) => segs.filter((s) => s.off).length > segs.length / 2;

// 可疑併塊：自動字幕有時把一長段話併成一個 seg，起點只是「前一個辨識到的聲音」之後，真正開口可能晚很多
// （BTraK6PHUp0 36:26.8：現場在笑，受訪旁白 36:40 才開始，整段中文早了 12 秒）。
// 說話落在 [起點, 下一個詞) 這段空檔的哪裡無從得知，只能標出來叫人去對畫面。
export const suspects = (segs) =>
  segs.flatMap((s, i) => {
    const next = segs[i + 1]?.t;
    const slack = next === undefined ? 0 : next - s.t - s.n * POS;
    return s.n >= MIN_CHUNK && slack > SLACK ? [{ ...s, next, slack }] : [];
  });
export const inBlock = (s, t) => t >= s.t - 0.5 && t < s.next; // 起點 t 的中文行算在併塊 s 裡（⚠ 報告、--resplit、--table 共用）

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

// 小段起點 S 沒貼到日文 seg 開頭（時間是估的），併回前一段又不超過 cap 字（不算標點），就不切。cap 0 = 一律不併
const guessed = (heads, cap) => (prev, p) => cap > 0 && !onHead(heads, p.S) && bare(prev.text + p.text) <= cap;
const join = (a, b) => Object.assign(a, { text: a.text + b.text, c: a.c + b.c, E: b.E });
function glue(pieces, merge) { // merge(前一段, 這段) 為真就把這段併回前一段
  const kept = [];
  for (const p of pieces) {
    if (kept.length && merge(kept.at(-1), p)) join(kept.at(-1), p);
    else kept.push(p);
  }
  return kept;
}

// ── 主流程：lines = [{t, text}]（起點遞增）→ pieces = [{text, c, S, E, s, e}]；s,e 是最後要顯示的起訖 ──
export function retime(lines, atoms, cap = 0) {
  const heads = atoms.filter((a) => a.head).map((a) => a.t);
  const loose = guessed(heads, cap);
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
    const mine = talk.slice(i, next?.i ?? talk.length).flatMap((l, li) => split(l.text).map((text) => ({ text, c: clen(text), li })));
    const inSpan = atoms.filter((a) => a.t >= T - 1e-6 && a.t < (next?.T ?? Infinity) - 1e-6);
    const placed = place(mine, T, next?.T ?? Infinity, inSpan).map((p, j) => ({ ...mine[j], ...p }));
    pieces.push(...glue(placed, (prev, p) => prev.li === p.li && loose(prev, p))); // 只併同一行切出來的
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

// ── --resplit：已校時的稿再切短。每行的起訖不動，只在行內按規則 1 切；每段到下一段起點，最後一段到原本的訖 ──
// lines = [{t, e, text}] → 每行一組 [{text, s, e}]。標註、不超過 cap 字、切不開的行原樣；⚠ 併塊裡的行也原樣（多半手校過），標 skip。
// 不超過 cap 的行不碰：切過一次的小段時間窗變窄，再切會貼到別的日文開口（WwCM 24:17.5 切在「探す」，該切的「タンスから」在 18.2）
// 切出來仍超過 cap 的小段（併回的）在自己的時間窗裡再切一次，切到不動為止，重跑才不會又多切
export function resplit(lines, atoms, sus, cap) {
  const heads = atoms.filter((a) => a.head).map((a) => a.t);
  const loose = guessed(heads, cap);
  const r = (x) => Math.round(x * 10) / 10;
  const deep = (l) => {
    const ps = once(l);
    return ps.length > 1 ? ps.flatMap((p) => deep({ t: p.s, e: p.e, text: p.text })) : ps;
  };
  return lines.map(deep);
  function once(l) {
    const parts = isNote(l.text) || bare(l.text) <= cap ? [l.text] : split(l.text);
    if (parts.length < 2 || sus.some((s) => inBlock(s, l.t))) return [{ text: l.text, s: l.t, e: l.e, skip: parts.length > 1 }];
    const mine = parts.map((text) => ({ text, c: clen(text) }));
    const inLine = atoms.filter((a) => a.t >= l.t - 0.05 - 1e-6 && a.t < l.e - 0.05 - 1e-6); // 稿上時間四捨五入到 0.1 秒：501.759 開口的寫成 501.8
    const placed = place(mine, l.t, l.e, inLine).map((p, j) => ({ ...mine[j], ...p }));
    const kept = glue(placed, (prev, p) => loose(prev, p) || p.S - prev.S < MIN_ABS); // 前一段連最短顯示時間都不到才不切（視覺優先，讀得有點趕也切）
    while (kept.length > 1 && l.e - kept.at(-1).S < MIN_ABS) { // 最後一段不到最短顯示時間：併回
      const p = kept.pop();
      join(kept.at(-1), p);
    }
    const out = kept.map((p, j) => ({ text: p.text, s: r(p.S), e: r(kept[j + 1]?.S ?? l.e) }));
    assert(out.every((p) => p.e > p.s) && out.map((p) => p.text).join('') === l.text, `細切壞了：${stamp(l.t)} ${l.text}`);
    return out;
  }
}

// ── 自我檢查：切行不掉字、起訖單調、（笑）不蓋掉還沒說完的話 ──
{
  const demo = '嗯。那這些孩子之後會變成怎樣呢？這之後會進入育成階段，現在待在放牧地的時間非常長，等到身體和心理成長到一定程度';
  assert(split('「問一下？」好。').join('|') === '「問一下？」好。' && split('一二三四五六七八九十？」好啊好啊，好。').join('|') === '一二三四五六七八九十？」|好啊好啊，好。', '括號要跟著句尾');
  assert(split(demo).join('') === demo && split(demo).every((p) => p.length <= MAX + 12), 'split 自我檢查失敗');
  const segs = [{ t: 10, text: 'ながいぶんしょう、にたいへんながい、ぶんしょうです。' }, { t: 20, text: 'つぎのぶんです。' }].map((s) => ({ ...s, n: jlen(s.text) }));
  const out = retime([{ t: 10, text: '很長的句子，還有後半。' }, { t: 11, text: '（笑）' }, { t: 20, text: '下一句。' }], atomsOf(segs));
  assert(out.map((p) => p.text).join('|') === '很長的句子，還有後半。|（笑）|下一句。', '順序錯了');
  assert(out[0].s === 10 && out[1].s > 11 && out[1].s >= 10 + 22 * POS && out[2].s === 20, '（笑）應等前一句說完才出現');
  assert(out.every((p, j) => p.e > p.s && (!out[j + 1] || p.e <= out[j + 1].s)), '起訖不單調');
  const sus = suspects([{ t: 0, n: 98 }, { t: 30, n: 3 }, { t: 33, n: 40 }, { t: 40, n: 3 }].map((x) => ({ text: '', ...x })));
  assert(sus.length === 1 && sus[0].t === 0, '可疑併塊：98 字佔 30 秒要標，40 字佔 7 秒不標');
  // 同一行切成兩段（含標點 14 > MAX），切點正好是日文 seg 開頭就留著；只有一個 seg、切點是估的，併完不算標點 12 ≤ MAX 就併回
  const mk = (...xs) => atomsOf(xs.map(([t, text]) => ({ t, text, n: jlen(text) })));
  const twoSegs = mk([10, 'あいうえおかき'], [12, 'さしすせそたち']);
  const line = '一二三四五六，七八九十壹貳。';
  assert(retime([{ t: 10, text: line }], twoSegs, MAX).map((p) => p.s).join() === '10,12', '切點在 seg 開頭要切');
  assert(retime([{ t: 10, text: line }], mk([10, 'あいうえおかきさしすせそたち']), MAX).length === 1, '估的切點、併完不超過 MAX 要併回');
  // --resplit：超過上限的已校時行在 seg 開頭切開、原本起訖不動；不超過上限的、⚠ 併塊裡的行不動
  const long = '一二三四五六七八九，十壹貳參肆伍陸柒捌。'; // 18 字 > MAX
  const rs = resplit([{ t: 10, e: 14, text: long }], twoSegs, [], MAX)[0];
  assert(rs.map((p) => `${p.s}-${p.e}`).join() === '10-12,12-14' && rs.map((p) => p.text).join('') === long, '細切：在 seg 開頭切、起訖不動');
  assert(resplit([{ t: 10, e: 14, text: line }], twoSegs, [], MAX)[0].length === 1, '細切：不超過上限的行不動（重跑結果才不變）');
  assert(resplit([{ t: 10, e: 14, text: long }], twoSegs, [{ t: 10, next: 20 }], MAX)[0][0].skip, '細切：⚠ 併塊裡的行不動');
  const rounded = mk([9.96, 'あ'.repeat(34)], [16.399, 'さしす']); // 稿上 10.0-16.4 是 9.96、16.399 四捨五入來的
  assert(resplit([{ t: 10, e: 16.4, text: '接著是ロゼミューズ的拍攝，還有一些沒拍完的部分，和自己的' }], rounded, [], MAX)[0].length === 3, '細切：行的起訖是四捨五入的，還是要對到自己那段日文');
  assert(['呢。我也是', '吧', '。', '」。'].every(orphan) && !['嘛，好啊', '呢喃', '（笑）'].some(orphan), '孤立語氣字／只有標點的行');
}

if (process.argv[1]?.endsWith('retime-subtitles.mjs')) {
  const flag = (f) => process.argv.includes(f);
  const [mdPath, jsonPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!mdPath || !jsonPath) throw new Error('用法：node scripts/retime-subtitles.mjs <影片.md> <ja-orig.json3> [--dry | --scan | --resplit [--dry] | --table]');
  const raw = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);
  const hit = raw.map((l, i) => ({ i, m: l.trim().match(LINE) })).filter((r) => r.m);
  assert(hit.length, '找不到 [mm:ss.d] 逐字稿行');
  const lines = hit.map(({ m }) => ({ t: sec(m[1], m[2]), e: m[3] && sec(m[3], m[4]), text: m[5].trim() }));
  const segs = loadSegs(jsonPath);
  const word = isWordLevel(segs);
  const cap = MAX;
  console.log(`來源：${word ? '逐字型' : '整塊型（切出來的新列起點多半是估的）'}（一列上限 ${cap} 字）`);

  const sus = suspects(segs);
  for (const s of sus) {
    const mine = lines.filter((l) => inBlock(s, l.t));
    console.log(`⚠ ${stamp(s.t)} 起一整塊 ${s.n} 字，${stamp(s.next)} 才有下一個詞（多出 ${s.slack.toFixed(0)} 秒空檔）：起點不可信；中文 ${mine.length} 行「${mine[0]?.text.slice(0, 12) ?? ''}…」→ 對畫面／聽音檔`);
  }
  console.log(sus.length ? `共 ${sus.length} 處可疑併塊` : '沒有可疑併塊');

  // 只換掉逐字稿那一段；中間夾了非時間行就不動（整段換掉會把它吃掉）
  const write = (pieces) => {
    const between = raw.slice(hit[0].i, hit.at(-1).i + 1).filter((l) => l.trim() && !LINE.test(l.trim()));
    assert(!between.length, `逐字稿中間夾了非時間行：${between[0]}`);
    if (!flag('--dry')) fs.writeFileSync(mdPath, [...raw.slice(0, hit[0].i), ...pieces.map((p) => `[${stamp(p.s)}-${stamp(p.e)}] ${p.text}`), ...raw.slice(hit.at(-1).i + 1)].join('\n'));
  };

  if (flag('--scan')) {
    const orph = lines.filter((l) => orphan(l.text));
    console.log(`孤立語氣字（句尾的呢吧嗎啦囉或標點擠到行首，應接回上一行）${orph.length} 行`);
    for (const l of orph) console.log(`  ${stamp(l.t)} ${l.text.slice(0, 20)}`);
    const talk = lines.filter((l) => !isNote(l.text));
    const long = talk.filter((l) => bare(l.text) > MAX);
    console.log(`超過 ${MAX} 字 ${long.length} 行`);
    for (const l of long) console.log(`  ${stamp(l.t)} ${l.text}`);
    const L = talk.map((l) => bare(l.text)).filter(Boolean).sort((a, b) => a - b); // 只有標點的行（「。」）不算
    const q = (p) => L[Math.min(L.length - 1, Math.floor(L.length * p))];
    const pct = (k) => `${Math.round((100 * k) / L.length)}%`;
    console.log(`字數（不含標註、不算標點）${L.length} 行：中位 ${q(0.5)}，p90 ${q(0.9)}，≤5 字 ${pct(L.filter((n) => n <= 5).length)}，>${MAX} 字 ${pct(L.filter((n) => n > MAX).length)}`);
  } else if (flag('--table')) {
    // 每行中文配上同一段時間說的日文：起點落在 [起, 訖) 的 seg，加上起點前一個還沒說完的 seg（沒有 -訖 就用下一行的起點）。
    // 沒出現在任何一行底下的日文插一列「未翻?」：可能漏翻
    const fin = segs.map((g, j) => Math.min(segs[j + 1]?.t ?? Infinity, g.t + g.n * SPC));
    const onsets = segs.map((g) => g.t);
    const ja = (gs) => `[${stamp(gs[0].t)}] ${gs.map((g) => g.text.replace(/\n/g, '')).join('')}`;
    const seen = new Set();
    const rows = lines.map((l, k) => {
      const e = l.e ?? lines.find((m) => m.t > l.t)?.t ?? l.t + need(clen(l.text));
      const mine = segs.filter((g, j) => g.t < e && (g.t >= l.t || fin[j] > l.t + 0.05));
      mine.forEach((g) => seen.add(g));
      // 估：起點不在日文開口 ±0.05 秒內。md 的時間已四捨五入到 0.1 秒，正好差 0.05 會被浮點誤差擠出去，所以多給 1e-6
      const flags = [!onHead(onsets, l.t, 0.05 + 1e-6) && '估', sus.some((s) => inBlock(s, l.t)) && '⚠', bare(l.text) > MAX && `>${MAX}`, orphan(l.text) && '孤', !mine.length && '無日文'];
      return { t: l.t, text: [`#${hit[k].i + 1} [${stamp(l.t)}-${stamp(e)}]`, ...flags.filter(Boolean), l.text].join(' ') + (mine.length ? `\n  ${ja(mine)}` : '') };
    }).sort((a, b) => a.t - b.t);
    let k = 0;
    let gap = [];
    const flush = () => { if (gap.length) console.log(`未翻? ${ja(gap)}`); gap = []; };
    for (const g of segs) {
      while (rows[k]?.t <= g.t) { flush(); console.log(rows[k++].text); }
      if (seen.has(g)) flush();
      else gap.push(g);
    }
    flush();
    for (; k < rows.length; k++) console.log(rows[k].text);
  } else if (flag('--resplit')) {
    assert(lines.every((l) => l.e !== undefined), '--resplit 只吃已校時的稿（每行都有 -訖）；只有起點的稿不加 --resplit 直接跑');
    const out = resplit(lines, atomsOf(segs), sus, cap);
    const parted = out.filter((ps) => ps.length > 1);
    console.log(`${lines.length} 列 → ${out.flat().length} 列；切開 ${parted.length} 列；⚠ 略過 ${out.filter((ps) => ps[0].skip).length} 列`);
    if (flag('--dry')) for (const ps of parted.filter((_, k) => k % Math.ceil(parted.length / 6) === 0)) console.log(`  ${ps.map((p) => `[${stamp(p.s)}-${stamp(p.e)}] ${p.text}`).join(' ｜ ')}`);
    write(out.flat());
  } else {
    assert(!hit.some(({ m }) => m[3]), '已經有 -訖 了（校時過）；請從只有起點的逐字稿重跑，例如 git 歷史裡的舊版（只想檢查就加 --scan，要把長行再切短用 --resplit）');
    const pieces = retime(lines, atomsOf(segs), cap);
    // 標註（笑）可能被排到被切開的長行中間，所以對話文字與標註分開比
    const same = (xs, pick) => xs.filter(pick).map((x) => x.text).join('');
    assert(same(pieces, (p) => !p.note) === same(lines, (l) => !isNote(l.text)) && [...same(pieces, (p) => p.note)].sort().join('') === [...same(lines, (l) => isNote(l.text))].sort().join(''), '字被改到了');

    const lagged = pieces.filter((p) => p.s - p.S > 0.05);
    const fast = pieces.filter((p) => p.c / (p.e - p.s) > CPS_MAX);
    const tight = pieces.filter((p) => p.note && p.e - p.s < MIN_ANN - 0.01);
    console.log(`${lines.length} 行 → ${pieces.length} 行；晚出現 ${lagged.length} 行（最多 ${Math.max(0, ...lagged.map((p) => p.s - p.S)).toFixed(1)} 秒）；讀太快（> ${CPS_MAX} 字/秒）${fast.length} 行；標註擠到不足 ${MIN_ANN} 秒 ${tight.length} 行`);
    for (const p of [...fast, ...tight]) console.log(`  ${stamp(p.s)}-${stamp(p.e)} ${p.text.slice(0, 30)}`);
    write(pieces);
  }
}
