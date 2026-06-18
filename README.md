# 書影閱讀器 · Reading App

本地優先（local-first）的 PWA，用來閱讀拍照的**日文 / 英文實體書**：拍照 →
OCR 取字 → 逐句翻成繁體中文 → 點選詞查字典存筆記。**所有 AI 推論都在裝置本地完成**，
模型下載後可離線使用，預設不連任何雲端服務。

> 目標平台：桌機瀏覽器 + Android（不支援 iOS / Safari）。UI 為繁體中文。

## 功能

- 📷 **拍照 / 上傳 + 手動框選裁切**，影像前處理（灰階、對比、去歪斜）
- 🔎 **兩階段 OCR**：PaddleOCR 偵測（onnxruntime-web，WebGPU→WASM）+ 辨識
  （英文 Tesseract.js / 日文 manga-ocr），含信心分數與幻覺把關
- 🌐 **逐句翻譯**：Opus-MT（本地，OpenCC 簡→繁）+ 桌機 Chrome Translator API 加分
- 📖 **日文斷詞查詞**：kuromoji.js + sql.js / JMdict，點選詞 → 釋義 → 存筆記本
- 📚 **書庫 / 書本 / 單頁閱讀 + 書籤 + 筆記本**（Dexie / IndexedDB 持久化）
- 📦 **PWA 離線**：模型權重下載後快取於 Cache Storage，分語言下載與進度 UX

## 技術棧

Vite + React 18 + TypeScript + Tailwind CSS v4 · `vite-plugin-pwa` · Dexie ·
onnxruntime-web · `@huggingface/transformers`（manga-ocr / Opus-MT）·
tesseract.js · kuromoji · sql.js · opencc-js

## 開發

```bash
npm install
npm run dev      # 開發伺服器（會先把 ORT/kuromoji/sql.js/tesseract 資產同步到 public/）
npm run build    # 產生 dist/
npm run preview  # 在類正式環境預覽（測試 PWA / 離線）
```

> 需要 secure context：開發用 `localhost`，部署用 HTTPS（WebGPU 與 persistent storage 需要）。

## 模型 / 資料來源（皆可在程式中以 `setXxx()` 覆寫）

| 用途 | 預設來源 |
| --- | --- |
| 文字偵測 | PaddleOCR PP-OCRv4 det（ONNX，`setDetModelUrl`） |
| 英文辨識 | Tesseract.js（`eng`，worker/core 自架，traineddata 首次走 CDN） |
| 日文辨識 | `Xenova/manga-ocr-base`（`setMangaOcrModel`） |
| 翻譯 | `Xenova/opus-mt-en-zh` / `Xenova/opus-mt-ja-zh`（`setOpusModel`）+ Chrome Translator API |
| 日文字典 | JMdict sqlite（需自備，`setDictDbUrl`，schema 見 `src/lib/dict/jmdict.ts`） |

詳細技術決定、已知限制與待辦見 [CLAUDE.md](CLAUDE.md)。

## 授權

MIT
