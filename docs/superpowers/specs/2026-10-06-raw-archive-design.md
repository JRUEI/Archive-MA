# MyArc（熟肉收藏站）設計

日期：2026-10-06　狀態：待使用者審閱

## 目標與成功標準

個人用的「熟肉（中文字幕影片）收藏站」，版型與資訊架構仿照 hrmtp（`harumatope-wiki`）與 jurii（`jurii-showroom`）。
hrmtp 以「第 N 回」分集；本站改以**資料夾**分類（例：`賽馬娘`）。

使用者每次丟一個 YouTube 連結，由 Claude 產出該影片的資料檔；網站顯示原影片封面圖，點進去可在站內播放並掛上中文字幕。

成功標準：
1. 範例影片 `https://www.youtube.com/watch?v=BTraK6PHUp0`（頻道「ぱかチューブっ!【ウマ娘公式】」）歸入資料夾「賽馬娘」，首頁卡片顯示其原封面。
2. 首頁可依資料夾切換。
3. 詳情頁內嵌播放器，影片上疊中文字幕，逐字稿可點時間跳轉。
4. 本機 `npm run dev` 可預覽；`npm run build` 通過。
5. push 到 `main` 後，GitHub Pages（`https://jruei.github.io/Archive-MA/`）自動更新。

## 範圍

**包含**：資料夾分頁加封面圖網格首頁、詳情頁（播放器、字幕疊層、字幕樣式工具列、逐字稿）、深色／亮色主題、右上選單。

**不包含**（hrmtp 有、本站刪除）：精簡總結、無損還原／段落卡片、精華片段、圖卡匯出、首頁時間軸排版切換、說話者標註工具、詞語庫、`legacy` 腳本、`docs/demos`。
同時移除只服務這些功能的相依套件：`html-to-image`、`jszip`、`file-saver`（以及確認未被使用後的 `react-markdown`）。

## 做法

複製 hrmtp 作為基底，刪減後換首頁。不重寫字幕程式、不抽共用套件。

注意：字幕相關元件**不是**原封不動可用，需要通用化：
- `TranscriptMode.tsx` 寫死主持人 `福嶋晴菜`、來賓配色、`solo` 判斷，並綁定 `SpeakerMarks`（本機專用的說話者標註）與 `api/speakers/route.dev.ts`。
- `lib/clips.ts` 的 `HOST` 常數、`lib/subtitle.ts` 的 `byVoice` 設定與 `harumatope_*` localStorage 鍵名。

## 資料模型

一支影片一個檔：`content/videos/<YouTube ID>.md`。

```markdown
---
title: "1日厩務員を体験 in ノーザンホースパーク【ウマ娘】"
channel: "ぱかチューブっ!【ウマ娘公式】"
folder: "賽馬娘"
date: "2026-xx-xx"
youtube: "https://www.youtube.com/watch?v=BTraK6PHUp0"
---

## 【完整逐字稿】
[00:03.2-00:06.9] 中文字幕
[00:07.5-00:10.1] 中文字幕
```

- `title`：原標題（oEmbed 取得）。`date`：影片發布日（`yt-dlp` 取得）。
- 逐字稿行格式沿用 hrmtp 解析器：`[mm:ss.d] 內容`；**不設說話者欄位**，站上任何地方都不顯示人名。
- 訖時間可有可無：`[mm:ss.d-mm:ss.d] 內容` 的字幕照寫的顯示（不蓋到下一行）；沒寫訖就依字數估（2–6 秒）。點時間跳轉與逐字稿列表只看起點。
- 資料夾不另設設定檔，由各檔 `folder` 值自動彙整。
- 檔名即 ID，也是詳情頁路由 `/videos/<id>`。

## 首頁

- 頂端資料夾分頁：「全部」加各資料夾（含數量）。選擇狀態存在網址 `?folder=`，可直接分享與重新整理。
- 下方 16:9 封面卡片網格（手機 1 欄、平板 2 欄、桌面 3 欄）；卡片含資料夾徽章、標題、頻道、日期。依發布日新到舊排序。
- 封面：`https://i.ytimg.com/vi/<id>/maxresdefault.jpg`，載入失敗（YouTube 對部分影片沒有 maxres）退回 `hqdefault.jpg`。不下載、不存圖。
- 站名 MyArc；頁首只留站名與深淺主題切換；深色預設。配色參考 YouTube（#0f0f0f／#181818／#272727、紅 #ff0000 系強調、連結藍）。
- 點卡片進詳情頁。
- 空狀態：無影片或該資料夾無影片時顯示一句說明，不空白。

## 詳情頁 `/videos/<id>`

- 頁首：資料夾徽章、標題、頻道、發布日、「前往 YouTube」連結。
- 內嵌 YouTube 播放器，上疊中文字幕；字幕樣式工具列（位置、字級、字重、三格快捷、時間補償）沿用。
- 逐字稿列表：點時間跳轉、搜尋、自動捲動，沿用。
- localStorage 鍵名由 `harumatope_*` 改為本站前綴，避免與 hrmtp 同源時互相覆蓋。

## 加入新影片的流程（由 Claude 執行）

1. 使用者提供連結與資料夾名稱。
2. `yt-dlp` 取得發布日與日文字幕；oEmbed 取得標題、頻道。
3. 日文字幕翻成繁體中文，沿用 hrmtp 的 `docs/subtitle-workflow.md` 規則（時間碼逐列照抄、不增刪列、每視覺行約 20 字）。
4. 寫入 `content/videos/<id>.md`，執行 `npm run validate:content`。
   - 想讓字幕停留時間貼著實際說話：用日文自動字幕（`ja-orig`）跑 `scripts/retime-subtitles.mjs`，把只有起點的逐字稿改成 `[起-訖]`（長行順便切短、字不改；用法見腳本開頭）。
5. 使用者在本機預覽確認。

## 驗證

- `scripts/validate-content.mjs`（由 hrmtp 版精簡）：frontmatter 必填欄位（`title`、`channel`、`folder`、`date`、`youtube`）、`youtube` 能解析出 11 碼 ID 且與檔名一致、逐字稿時間不倒退且行數大於 0；有寫訖的行，訖要晚於起、且不晚於下一行起點。失敗則 build 失敗。
- `npm run lint`、`npm run typecheck`、`npm run build`。
- 瀏覽器實測：首頁資料夾切換、封面載入與退回、詳情頁播放與字幕同步、深淺主題、手機寬度。
- 依 CLAUDE.md，UI 完成前要通過 `visual-alignment` 檢查。

## 部署

- 本機：`dev_archive.bat`（port 3200）。
- 線上：GitHub Pages `https://jruei.github.io/Archive-MA/`，沿用 Archive-HRMTP／Archive-Jurii 的做法（公開 repo、Actions 部署）。push 到 `main` 後由 `.github/workflows/deploy.yml` 建置。
- `next.config.ts` 只在 GitHub Actions（`GITHUB_ACTIONS`）下改成 `output: "export"`、`basePath: /Archive-MA`、`trailingSlash`，本機 dev／build 不受影響。`/videos/[id]` 用 `generateStaticParams` 在建置時列出所有影片，所以新增影片要 commit + push 才會上線。
- 本機模擬線上：`GITHUB_ACTIONS=true npm run build`，產出 `out/`，要掛在 `/Archive-MA/` 底下才開得起來。
- `robots` 維持 `noindex`。字幕疊層預設關閉，新裝置要按一次「字幕」開關，設定記在該瀏覽器的 localStorage。

## 已知限制

- 沒有日文字幕（連自動字幕都沒有）的影片需要語音辨識；本機目前沒有 ffmpeg 與 Whisper，v1 不建，遇到時再討論。
- 封面圖引用 YouTube 外部圖床；影片被下架或設為私人時封面會失效。v1 不備份。
- 資料夾為單層、一支影片只屬於一個資料夾。
- 詳情頁沿用 hrmtp 的逐字稿與字幕程式約 1,650 行，通用化後需要實測，不能假設原樣可用。
