// 影片上字幕的純函式檢查：node scripts/check-subtitle.mjs
// 引號補成對、熟肉樣式、字幕停留時間與查找、localStorage 存檔的讀回。壞掉就丟錯、結束碼非 0。
import assert from 'node:assert/strict';
import {
  DEFAULT_SUBTITLE_STATE,
  balanceQuotes,
  buildSubtitleRows,
  parseSubtitleState,
  plainSubtitle,
  rowAt,
} from '../src/lib/subtitle.ts';

// ── 引號補成對 ──
assert.deepEqual(balanceQuotes(['他說「好」然後走了']), ['他說「好」然後走了'], '一列內成對的不動');
assert.deepEqual(balanceQuotes(['他說「好」', '走了']), ['他說「好」', '走了'], '收掉的引號不會漏到下一列');
assert.deepEqual(
  balanceQuotes(['他說「我想想', '還是不要', '好啦」就這樣']),
  ['他說「我想想」', '「還是不要」', '「好啦」就這樣'],
  '跨三列：第一列補」、中間補「…」、最後一列補「，」後面的字照留',
);
assert.deepEqual(
  balanceQuotes(['他說「我想想', '還是不要', '好啦」就這樣'], ['A', 'A', 'A']),
  ['他說「我想想」', '「還是不要」', '「好啦」就這樣'],
  '同一人連說三列，跟沒給說話者一樣',
);
assert.deepEqual(
  balanceQuotes(['「我想想', '好啊', '結論'], ['A', 'B', 'A']),
  ['「我想想」', '好啊', '結論'],
  '換人說話就從引號外重算，別人的話不會被包進去',
);
assert.deepEqual(
  balanceQuotes(['「好', '啦」然後「再來']),
  ['「好」', '「啦」然後「再來」'],
  '同一列先收再開',
);
assert.deepEqual(
  balanceQuotes(['他說「好', '然後']),
  ['他說「好」', '「然後」'],
  '到最後都沒收的引號，每一列都補成對',
);
assert.deepEqual(balanceQuotes([]), []);

// ── 熟肉樣式：列尾／收引號前的句讀拿掉、列內的換空格，？！留著 ──
for (const [text, want, msg] of [
  ['真的嗎！？好啊。', '真的嗎！？好啊', '列內的！？照留、列尾的。拿掉'],
  ['會做什麼嗎？', '會做什麼嗎？', '列尾的？留著'],
  ['好耶！走吧！', '好耶！走吧！', '！列內列尾都留'],
  ['不，其實我也，覺得今天去得了嗎，', '不 其實我也 覺得今天去得了嗎', '列內的，換空格、列尾的拿掉'],
  ['「要做什麼好呢」的感覺，', '「要做什麼好呢」的感覺', '引號不動'],
  ['「好啊，」', '「好啊」', '收引號前的，拿掉（balanceQuotes 補上的」也算）'],
  ['「真的嗎？」', '「真的嗎？」', '收引號前的？留著'],
  ['所以、那個；嗯。。', '所以 那個 嗯', '連續的句讀併成一個空格'],
  ['等一下……（笑）', '等一下……（笑）', '……與（笑）不動'],
  ['寄到 hiyonoma.radio@gmail.com。', '寄到 hiyonoma.radio@gmail.com', '半形的 . 不是句讀'],
]) assert.equal(plainSubtitle(text), want, msg);

// ── 停留時間與查找（整秒、0.1 秒小數都要能用）──
const rows = buildSubtitleRows([
  { seconds: 10, text: '短' }, // 1 字：1.48 秒，補到下限 2 秒
  { seconds: 20.4, text: '一二三四五六七八九十'.repeat(4) }, // 40 字：補到上限 6 秒
  { seconds: 30, text: '「半句' }, // 被下一列截斷
  { seconds: 30.5, text: '後半」 ' }, // 最後一列沒有下一列，空白不算字數
]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
close(rows[0].end, 12);
close(rows[1].end, 26.4);
close(rows[2].end, 30.5);
close(rows[3].end, 30.5 + 2.04);
assert.deepEqual(
  rows.map(r => r.text),
  ['短', rows[1].text, '「半句」', '「後半」 '],
  '顯示字串補成對，結束時間用原字數算',
);
const at = (t, want, msg) => assert.equal(rowAt(rows, t), want, `${msg}（t=${t}）`);
at(9.99, -1, '第一列開始前');
at(10, 0, '剛好開始');
at(11.99, 0, '停留中');
at(12, -1, '結束時間不含');
at(15, -1, '兩列之間的空檔');
at(20.4, 1, '小數起點');
at(26.39, 1, '上限之內');
at(26.4, -1, '超過上限就空白');
at(30.49, 2, '被截斷的前一列');
at(30.5, 3, '下一列接手');
at(99, -1, '最後一列之後');
assert.equal(rowAt([], 5), -1, '沒有字幕');

// ── 有寫結束時間（[起-訖]）：照寫的，不蓋到下一列；沒寫或寫壞了退回字數估 ──
const ranged = buildSubtitleRows([
  { seconds: 10, end: 14.5, text: '短' }, // 照寫的 4.5 秒，不吃 2 秒下限的公式
  { seconds: 20, end: 25, text: '二' }, // 寫到 25，但下一列 22 就開始
  { seconds: 22, text: '沒寫訖' }, // 沒寫：3 字 2.04 秒
  { seconds: 30, end: 30, text: '訖等於起' }, // 寫壞（訖 ≤ 起）：退回字數估，4 字 2.32 秒
]);
close(ranged[0].end, 14.5);
close(ranged[1].end, 22);
close(ranged[2].end, 24.04);
close(ranged[3].end, 32.32);
assert.equal(rowAt(ranged, 14.49), 0, '寫的訖之前還在');
assert.equal(rowAt(ranged, 14.5), -1, '寫的訖一到就收');

// ── 存檔讀回 ──
assert.deepEqual(parseSubtitleState(null), DEFAULT_SUBTITLE_STATE, '沒存過');
assert.deepEqual(parseSubtitleState('{不是 json'), DEFAULT_SUBTITLE_STATE, '壞掉的 JSON');
assert.deepEqual(parseSubtitleState('{"v":2,"on":true}'), DEFAULT_SUBTITLE_STATE, '版本不對');
assert.deepEqual(parseSubtitleState('[1,2]'), DEFAULT_SUBTITLE_STATE, '不是物件');

const messy = parseSubtitleState(
  JSON.stringify({
    v: 1,
    on: 'yes',
    cur: { sb: 999, sf: -3, sw: '700', c: 'zzz', ss: 0.5 },
    slots: [{ c: '#00ff00', sb: 20 }, 'x', null, { c: '#fff' }],
    def: 1,
    offset: 5000,
    plain: 'yes',
    summary: 1,
  }),
);
assert.deepEqual(messy, {
  v: 1,
  on: false,
  cur: { sb: 45, sf: 2.5, sw: 700 },
  slots: [{ sb: 20, sf: 4.4, sw: 700 }, null, null],
  names: ['', '', ''],
  def: null,
  offset: 800,
  plain: false,
}, '亂填的欄位夾回範圍、多的欄位丟掉、指到空格的預設清掉');
assert.equal(parseSubtitleState('{"v":1,"on":true}').plain, false, '舊存檔沒有熟肉欄位：預設關');
assert.deepEqual(Object.keys(messy.slots[0]).sort(), ['sb', 'sf', 'sw'], '快捷只存樣式三欄');

const good = {
  v: 1,
  on: true,
  cur: { sb: 8, sf: 5.2, sw: 800 },
  slots: [{ sb: 20, sf: 3, sw: 400 }, null, null],
  names: ['夜間', '', ''],
  def: 0,
  offset: -200,
  plain: true,
};
assert.deepEqual(parseSubtitleState(JSON.stringify(good)), good, '正常的存檔原樣讀回');

console.log('check-subtitle: ok');
