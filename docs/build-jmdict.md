# 建立 JMdict 字典 (sql.js) 並上架

讓「點選日文詞 → 查字典」可用。做法：把公開的 **jmdict-simplified**
（https://github.com/scriptin/jmdict-simplified）轉成符合 App schema 的 SQLite，
上傳到你的 Hugging Face（public），再在 App 設定貼上網址。釋義為英文（JMdict eng）。

> 在你自己的電腦跑；上傳用你的 HF write token。

## App schema（`src/lib/dict/jmdict.ts`）
```sql
entries(id INTEGER PRIMARY KEY, kanji TEXT, reading TEXT, glosses TEXT)
-- 查詢：WHERE kanji = ?term OR reading = ?term OR kanji = ?baseform
```
腳本每個 JMdict 詞會建：每個漢字寫法一列（kanji=寫法, reading=主要假名）、
每個假名一列（kanji=NULL, reading=假名），所以點漢字或假名都查得到。

## 步驟
```bash
python -m venv venv && source venv/bin/activate     # 或沿用既有 venv
pip install requests huggingface_hub

# 轉換（完整字典；想要小一點可加 --common 只收常用詞）
python scripts/build-jmdict-sqlite.py --out jmdict.sqlite
#   完整約 40–70 MB；--common 明顯更小

# 上傳到你的帳號（public）
hf auth login
hf upload <your-username>/jmdict-sqlite jmdict.sqlite jmdict.sqlite
```

## 在 App 啟用
預設已指向 `ms57rd/jmdict-sqlite`。若那是你的 repo 就直接可用；
否則 App → 設定 → 進階 → 日文字典 → 貼上：
```
https://huggingface.co/<your-username>/jmdict-sqlite/resolve/main/jmdict.sqlite
```
存檔後回設定頁「日文字典」按下載，之後在閱讀頁點日文詞即可查詞並存入筆記本。

## 備註
- repo 要 **public**（App 純前端、匿名抓）。
- 要改用中文釋義（JP→ZH / CC-CEDICT）可換資料來源並沿用同 schema；
  或用 `setLookupSql()` 調整查詢以對應你自己的 schema。
