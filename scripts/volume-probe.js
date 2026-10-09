// 在 YouTube 播放頁量「說話頻段」（200–4000 Hz）的音量，給 ⚠ 可疑併塊找開口與停頓（不下載音檔、不用 ASR）。
// 用法：瀏覽器開 https://www.youtube.com/watch?v=<ID>，把整個檔案貼進 javascript 工具執行一次，接著：
//   __run(窗)  窗 = place-blocks.mjs 印的 [{k,a,b}]；逐窗跳過去播放、錄音量。輸出接到靜音，背景分頁也能錄。
//              很久（窗長總和），不要 await：直接呼叫，之後看 __status 到 'done'。錄過的窗不重錄；廣告期間不錄（ad=true）
//   __ana()    每窗一段：0.1 秒一格的 dB；高於 max(底噪 +8, 峰值 −30) dB 算有聲音（底噪＝第 15 百分位，峰值＝第 98 百分位）
//              第二行一格 0.2 秒（從窗起點算，每 10 秒一個 |）：# ≥ 峰值−4，= ≥ −10，- ≥ −16，. ≥ −22 dB，空白更小
//              第三行有聲段：間隔 ≤ 0.3 秒併起來，短於 0.2 秒不算
// 判讀：開口＝有聲段起點；日文約每秒 6–7 拍，拿來把中文小段分給各有聲段。音量分不出笑聲跟說話；有 BGM 時切點 ±1 秒。
(() => {
  const v = document.querySelector('video');
  if (!window.__an) {
    const ac = new AudioContext();
    const src = ac.createMediaElementSource(v);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
    const sp = ac.createScriptProcessor(1024, 1, 1); // AudioWorklet 要另外載檔；這個在背景分頁也照跑（約每秒 47 次）
    const mute = ac.createGain(); mute.gain.value = 0;
    src.connect(hp); hp.connect(lp); lp.connect(sp); sp.connect(mute); mute.connect(ac.destination);
    window.__an = { ac, rec: null };
    sp.onaudioprocess = (e) => {
      const r = window.__an.rec;
      if (!r || v.paused || v.seeking) return;
      if (document.querySelector('#movie_player')?.classList.contains('ad-showing')) { r.ad = true; return; }
      const d = e.inputBuffer.getChannelData(0); let s = 0; for (const x of d) s += x * x;
      r.env.push([+v.currentTime.toFixed(3), Math.sqrt(s / d.length)]);
    };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__res ??= {};
  window.__run = async (wins) => {
    await window.__an.ac.resume();
    for (const w of wins) {
      if (window.__res[w.k]?.env?.length) continue;
      window.__status = 'seek ' + w.k;
      v.pause(); v.currentTime = w.a;
      for (let i = 0; i < 50 && (v.seeking || v.readyState < 3); i++) await sleep(100);
      const r = { env: [], ad: false };
      v.muted = false; v.volume = 1; v.playbackRate = 1;
      window.__an.rec = r;
      await v.play();
      window.__status = 'rec ' + w.k;
      let last = -1, stuck = 0;
      while (v.currentTime < w.b && stuck < 100) { await sleep(100); stuck = v.currentTime === last ? stuck + 1 : 0; last = v.currentTime; }
      window.__an.rec = null; v.pause();
      window.__res[w.k] = { a: w.a, b: w.b, ad: r.ad, stuck: stuck >= 100, env: r.env };
    }
    window.__status = 'done';
  };
  window.__ana = () => Object.entries(window.__res).map(([k, r]) => {
    const bins = new Map();
    for (const [t, x] of r.env) { const b = Math.floor(t * 10); const o = bins.get(b) ?? [0, 0]; o[0] += x * x; o[1]++; bins.set(b, o); }
    const ks = [...bins.keys()].sort((a, b) => a - b);
    if (!ks.length) return `${k} 沒錄到（ad=${r.ad} stuck=${r.stuck}）`;
    const db = new Map(ks.map((b) => { const [s, n] = bins.get(b); return [b, 10 * Math.log10(s / n + 1e-12)]; }));
    const vals = [...db.values()].sort((a, b) => a - b);
    const floor = vals[Math.floor(vals.length * 0.15)], peak = vals[Math.floor(vals.length * 0.98)];
    const thr = Math.max(floor + 8, peak - 30);
    const spans = []; let cur = null;
    for (const b of ks) {
      if (db.get(b) <= thr) continue;
      if (cur && b / 10 - cur[1] <= 0.3) cur[1] = b / 10 + 0.1; else spans.push(cur = [b / 10, b / 10 + 0.1]);
    }
    const sp = spans.filter((s) => s[1] - s[0] >= 0.2).map((s) => s[0].toFixed(1) + '-' + s[1].toFixed(1));
    let line = '';
    for (let b = ks[0]; b <= ks.at(-1); b += 2) {
      const d = Math.max(db.get(b) ?? -200, db.get(b + 1) ?? -200) - peak;
      line += d >= -4 ? '#' : d >= -10 ? '=' : d >= -16 ? '-' : d >= -22 ? '.' : ' ';
    }
    return `${k} [${(ks[0] / 10).toFixed(1)}..${(ks.at(-1) / 10).toFixed(1)}] floor ${floor.toFixed(0)} peak ${peak.toFixed(0)} thr ${thr.toFixed(0)} ad=${r.ad} stuck=${r.stuck}\n${line.replace(/(.{50})/g, '$1|')}\n${sp.join(' ')}`;
  }).join('\n\n');
  return [v.duration, window.__an.ac.state, location.search];
})();
