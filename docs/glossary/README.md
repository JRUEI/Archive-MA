# 字幕知識庫

修 ASR、翻字幕時查的資料。翻譯原則在 `docs/translation-guidelines.md`，這裡只放「這個詞要寫成什麼」。

## ASR 出現怪字時查哪裡

| ASR 給的是… | 查 |
|---|---|
| 人名、暱稱、「〇〇ちゃん」「〇〇さん」 | [cast.md](cast.md)：每個馬娘一列，聲優、暱稱、ASR 誤聽、字幕寫法都在同一列 |
| 不是人名的專有名詞、遊戲內作品、活動名、梗 | [terms.md](terms.md) |
| 歌名、像歌詞的句子、和歌詞呼應的發言 | [songs.md](songs.md)，歌詞本身在 `lyrics/`（本機，不進版控） |
| 這句以前怎麼翻過 | [phrasing.md](phrasing.md) |
| 某場演出誰有上台、唱了什麼 | `events/`（例：[6th EVENT](events/6th-event.md)） |
| 某支影片已確認的時間點與名字 | `videos/<ID>.md`（例：[okctzi0u47Y](videos/okctzi0u47Y.md)） |

## 寫入規則

- 使用者聽過、確認過的寫「確認」；查來源推的寫來源；猜的寫「未確認」。
- 同一個人的資料只放在 cast.md 那一列，影片筆記只寫時間點，指回 cast.md。
- 新影片的確認事項先記在 `videos/<ID>.md`，會在別支影片再出現的（人名、術語、譯法）搬到上面三份。
