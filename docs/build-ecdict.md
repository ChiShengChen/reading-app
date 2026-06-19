# 建立 ECDICT 英文字典 (sql.js) 並上架

讓你讀**英文**時也能「點單字 → 查中文意思」。資料來自開源 **ECDICT**
（https://github.com/skywind3000/ECDICT，英→漢，含音標與中文釋義）。
轉成 App schema 的 SQLite，上傳到你的 Hugging Face（public），在設定貼上網址。

> 在你自己的電腦跑；上傳用你的 HF write token。

## App schema（`src/lib/dict/ecdict.ts`）
```sql
entries(word TEXT, phonetic TEXT, translation TEXT)   -- word 為小寫
-- 查詢：點到的單字 + 幾個去字尾的候選（複數 / -ed / -ing / -ly）一起查
```

## 步驟
```bash
source venv/bin/activate            # 或沿用既有 venv
pip install requests huggingface_hub

# 轉換：建議 --common（常用詞，檔案小、適合手機）；不加則為完整字典（較大）
python scripts/build-ecdict-sqlite.py --out ecdict.sqlite --common

# 上傳（public）
hf auth login
hf upload <your-username>/ecdict-sqlite ecdict.sqlite ecdict.sqlite
```

## 在 App 啟用
預設已指向 `ms57rd/ecdict-sqlite`。若那是你的 repo 就直接可用；
否則 App → 設定 → 進階 → 英文字典 → 貼上：
```
https://huggingface.co/<your-username>/ecdict-sqlite/resolve/main/ecdict.sqlite
```
存檔 → 設定頁「英文字典」按下載 → 回閱讀頁切「英文」，辨識後點任一單字即可查詞、存筆記本。

## 備註
- repo 要 **public**。
- 去字尾是簡單啟發式（涵蓋多數複數/時態/副詞）；查不到時可試原形。
- `--common` 用 BNC/詞頻排名前 N（預設 25000）過濾，可用 `--max-rank` 調整。
