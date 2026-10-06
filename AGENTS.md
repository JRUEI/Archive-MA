# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# MyArc 備忘

- 設計文件：`docs/superpowers/specs/2026-10-06-raw-archive-design.md`
- 一支影片 = `content/videos/<YouTubeID>.md`；改完跑 `npm run validate:content`
- 字幕行 `[mm:ss.d] 中文` 或 `[起-訖] 中文`。新影片翻好後，用 `node scripts/retime-subtitles.mjs content/videos/<ID>.md <ID>.ja-orig.json3` 依日文自動字幕補 `-訖`（只吃只有起點的稿；yt-dlp 抓檔指令在腳本開頭）。輸出若有 ⚠ 可疑併塊（自動字幕起點不可信），上線前必須對畫面／聽音檔校過；已校時的稿用 `--scan` 只做檢查。細節見 `docs/translation-guidelines.md` §4
- 本地啟動：`dev_archive.bat`（port 3200）
- 上線：GitHub Pages `https://jruei.github.io/Archive-MA/`，push 到 `master` 後由 `.github/workflows/deploy.yml` 靜態輸出並部署；新增／修改影片要 commit + push 才會上線。本機模擬：`GITHUB_ACTIONS=true npm run build`（`next.config.ts` 在 Actions 下才改成 export + basePath），產出 `out/`，要掛在 `/Archive-MA/` 底下才開得起來
- 翻譯／修飾字稿的原則：`docs/translation-guidelines.md`
- 版面比較與方案提案做成 `docs/demos/demo_xxx.html`，不要寫成 Markdown 報告
