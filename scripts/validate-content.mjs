// 檢查 content/videos/*.md：必填欄位、youtube 連結與檔名一致、逐字稿時間不倒退、[起-訖] 的訖要晚於起且不晚於下一行起點。有錯就 exit 1（build 會跟著失敗）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "videos");
const REQUIRED = ["title", "channel", "folder", "date", "youtube"];
const LINE = /^\[(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d))?(?:-(\d{2}:\d{2}(?::\d{2})?)(?:\.(\d))?)?\]\s*(.+)$/;
const toSec = (hms, d) => hms.split(":").map(Number).reduce((a, n) => a * 60 + n, 0) + Number(d ?? 0) / 10;
const ID = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v)\/))([a-zA-Z0-9_-]{11})/;

const errors = [];
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")) : [];

for (const file of files) {
  const fail = (msg) => errors.push(`${file}: ${msg}`);
  const { data, content } = matter(fs.readFileSync(path.join(dir, file), "utf8"));

  for (const key of REQUIRED) if (!data[key]) fail(`缺少 frontmatter 欄位 ${key}`);
  const id = String(data.youtube ?? "").match(ID)?.[1];
  if (data.youtube && id !== file.replace(/\.md$/, "")) fail(`youtube 連結的 ID（${id ?? "解析不出"}）和檔名不符`);

  let prev = -1;
  let prevEnd = null; // 上一行寫的訖，不能晚於這一行的起點
  let count = 0;
  content.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith("[")) return;
    const m = line.match(LINE);
    if (!m) return fail(`第 ${i + 1} 列格式不符 [mm:ss.d] 或 [mm:ss.d-mm:ss.d] 內容`);
    const t = toSec(m[1], m[2]);
    if (t < prev) fail(`第 ${i + 1} 列時間倒退`);
    if (prevEnd !== null && prevEnd > t) fail(`第 ${i + 1} 列起點早於上一行的結束時間`);
    const end = m[3] ? toSec(m[3], m[4]) : null;
    if (end !== null && end <= t) fail(`第 ${i + 1} 列結束時間不晚於起點`);
    prev = t;
    prevEnd = end;
    count++;
  });
  if (count === 0) fail("沒有任何逐字稿行");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`content OK：${files.length} 支影片`);
