# 專案啟動 Prompt：日英書籍拍照閱讀器（本地 OCR + 翻譯 PWA）

> 用法：把整份貼給 Claude Code 當第一則訊息。它會建專案並**只實作 Phase 1**，做完停下來回報。
> 持久規則（Hard Constraints + Tech Stack + Critical Rules）建議另存成 `CLAUDE.md`，讓後續 session 自動讀到。

---

## 角色與目標

你要打造一個**閱讀實體日文/英文書籍的 PWA**。使用者用手機或電腦拍下書頁照片，App 把每頁文字辨識出來、逐段與中文（zh-Hant）對照翻譯，並提供書籤與「選詞/選句」筆記本。**所有 AI 推論都在裝置本地完成，預設不連任何雲端服務。**

主要使用情境：**實體書拍照為主**（不是電子書）。目標讀者母語是繁體中文。

## Hard Constraints（不可違反）

- **平台只有：桌機瀏覽器 + Android。完全不需要支援 iOS / Safari。** 不要為 iOS 寫任何 fallback 或 workaround。
- **純本地、local-first。** 沒有後端、沒有帳號、沒有資料庫伺服器。唯一允許的網路請求是「下載模型權重與字典檔」（從 CDN / Hugging Face）。不要加 analytics、不要預設接雲端 LLM。
- **離線可用。** 模型下載後，閱讀/OCR/翻譯/查詞都要能離線跑。
- 需要 **secure context**：開發用 localhost，部署用 HTTPS（WebGPU 與 persistent storage 都需要）。
- UI 文案用繁體中文。程式碼、識別字、註解用英文。

## Tech Stack（已決定，不要再開放討論；要換請先說明理由）

- **建置**：Vite + TypeScript
- **UI**：React 18 + Tailwind CSS
- **PWA**：`vite-plugin-pwa`（service worker、manifest、離線快取）
- **本地儲存**：Dexie.js（IndexedDB）；啟動時呼叫 `navigator.storage.persist()` 保護大型模型快取不被系統清除
- **OCR runtime**：以 **WebGPU 為主、WASM 為 fallback** 的統一技術棧，桌機與 Android 跑同一條 pipeline
  - PaddleOCR 偵測模型 → 用 `onnxruntime-web`（WebGPU execution provider，無 WebGPU 時退 WASM）
  - manga-ocr → 用 `@huggingface/transformers`（Transformers.js v3，`device: 'webgpu'`）以 VisionEncoderDecoder 載入
- **影像前處理**：OpenCV.js 或 canvas（去歪斜、透視校正、去噪、放大）+ 手動框選裁切 UI
- **翻譯**：`@huggingface/transformers` 跑 Opus-MT（ja→zh、en→zh 的 ONNX build）；桌機額外用 feature detection 接 Chrome 內建 **Translator API** 當品質升級
- **日文斷詞**：kuromoji.js（字典檔放 `public/` 用 fetch 載入）
- **字典**：sql.js + JMdict（日→英），可再加 JP→ZH 或 CC-CEDICT 補中文釋義

## 架構：統一 WebGPU pipeline

裝置只分**兩層**，用 `navigator.gpu` 偵測：

1. **有 WebGPU（桌機 + 現代 Android）** → 完整 pipeline：PaddleOCR 偵測 + manga-ocr 辨識 + Opus-MT 翻譯，全走 WebGPU。
2. **無 WebGPU（老舊 Android）** → 退到 WASM execution provider，或改用較輕的 PaddleOCR 辨識器；可接受能力縮水。

Chrome 內建 AI（Gemini Nano / Translator API）**只是桌機加分項**，不是必要層——一律先確保統一棧能跑，桌機再用 feature detection 疊加。注意：**Gemini Nano 不支援中文**，所以中文譯文一律走 Opus-MT 或 Translator API，不要叫 Nano 產生中文。

## OCR 是核心，且必須兩階段

拍照 OCR **絕對不能**用單一引擎吃整頁。流程：

```
拍照/上傳 → 前處理(去歪斜/校正/去噪/放大) → 手動可調裁切
   → [偵測] PaddleOCR 找出每一行/塊文字區域並裁切
   → [辨識] 逐區域送 manga-ocr(日) / PaddleOCR 或 Tesseract(英)
   → 切句 → 逐段翻譯 → 原文/譯文對照渲染
```

### Critical Rules（這些是踩過的雷，務必照做）

1. **先偵測再辨識。** 永遠不要把整頁或未經偵測的區域丟給 manga-ocr。先用偵測模型裁出緊密的文字框，加少量 padding，再逐框辨識。
2. **manga-ocr 會幻覺。** 它對空白輸入也一定吐出文字，且因為是 transformer decoder，可能生出看似真實的句子。**每個區域都要用偵測信心分數把關**：信心過低或實質空白的區域直接丟棄，不要渲染。
3. **裁切要緊。** 裁太鬆辨識會錯（例如括號誤判）。偵測框的品質直接決定辨識品質。
4. **振假名（furigana）會污染結果**，必要時依字級高度過濾掉行內的小字 ruby。
5. **模型 lazy load + 快取。** 權重存 Cache Storage / IndexedDB，依語言分開下載，顯示下載進度。第一次用日文可能要下載 ~600MB–1GB（manga-ocr ONNX 約 440MB + 偵測 + 翻譯模型）。
6. **下載 UX：** 用 `navigator.connection`（`effectiveType` / `saveData`）偵測，建議連到 WiFi 才提示下載大模型；盡量可續傳。
7. **Android 硬體跨度大。** 鎖定中高階機；低階（2–3GB RAM）走 WASM 退路。壓力主要來自 manga-ocr。

### 參考實作（先讀架構，省時間）

- **yomikomi**（github.com/sieugene/yomikomi）：幾乎一樣的東西——瀏覽器內 OCR + 字典 + 翻譯，用 @xenova/transformers、PaddleOCR、Kuromoji、sql.js。
- **Namida-OCR**（github.com/Leapward-Koex/Namida-OCR）：瀏覽器 OCR，Tesseract 預設 + PaddleOCR ONNX 後端，支援日文直書/振假名/snip 放大。

## 資料模型（Dexie，先做這個 schema）

- `books`：id, title, language('ja'|'en'), cover(thumbnail Blob), createdAt
- `pages`：id, bookId, index, imageBlob, ocrRegions(JSON: box+text+confidence), fullText, translation, processedAt
- `bookmarks`：id, bookId, pageIndex, label, note, createdAt
- `notes`（筆記本）：id, sourceType('word'|'sentence'), term, reading, definition, contextSentence, bookId, pageIndex, userNote, tags[], createdAt
- `settings`：targetLanguage('zh-Hant'), preferredEngine, downloadedModels[] …

## 開發階段（依序，先把最risky的做掉）

- **Phase 0｜Scaffold**：Vite+TS+React+Tailwind+Dexie+vite-plugin-pwa；capability detection util（`navigator.gpu`、`navigator.storage`、`navigator.connection`）；啟動申請 persistent storage；基本 layout 與路由（書庫 / 閱讀 / 筆記本）。
- **Phase 1｜OCR loop v1（本次重點）**：拍照/上傳 + 手動裁切 UI → 前處理 → PaddleOCR 偵測（ORT WebGPU，WASM fallback）+ 一個辨識引擎 → 把單頁辨識出的文字顯示在畫面上。**先用 PaddleOCR rec 或 Tesseract(eng) 把英文這條打通以降風險**，跑通「照片 → 可靠文字」的端到端。
- **Phase 2**：接 manga-ocr 做日文辨識；強化前處理；區域→切句；信心分數把關。
- **Phase 3**：原文/譯文並排；Opus-MT（WebGPU）跨平台翻譯；桌機 feature-detect 疊加 Translator API。
- **Phase 4**：Kuromoji 斷詞 + 點選詞/句 + sql.js 字典查詢 → 存筆記本；書籤。
- **Phase 5**：兩層模型載入 + 下載 UX（WiFi 提示、分語言、進度、續傳）+ WASM 退路 + 離線/PWA 收尾。

## 這次請你做什麼

1. 先做 **Phase 0 scaffold**，確認 `npm run dev` 跑得起來。
2. 接著**只實作 Phase 1**：照片 → 前處理 → PaddleOCR 偵測 + 辨識 → 螢幕上顯示取出的文字。先用英文路徑驗證端到端，再說明怎麼切換到 manga-ocr。
3. **做完 Phase 1 就停下來**，回報：哪些能跑、做了哪些技術決定、選了哪些確切的模型 ID 與為什麼、下一步建議。**不要一次把所有 Phase 都寫完。**

工作守則：
- 每個 Phase 結束都要能 `npm run dev` 實際跑起來再往下。
- 要加清單以外的重型依賴，先問我。
- 用 `CLAUDE.md` 維護一份技術決定紀錄（選了哪個模型、為什麼、已知限制）。
- 程式碼防禦性地遵守上面 Critical Rules（特別是偵測在前、幻覺把關、裁切要緊）。