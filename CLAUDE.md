# CLAUDE.md — 日英書籍拍照閱讀器

本檔是給後續 session 自動讀取的**持久規則 + 技術決定紀錄**。先讀這裡再動手。

---

## Hard Constraints（不可違反）

- **平台只有桌機瀏覽器 + Android。不支援 iOS / Safari。** 不要為 iOS 寫 fallback / workaround。
- **純本地、local-first。** 沒有後端、沒有帳號、沒有 DB 伺服器。唯一允許的網路請求是**下載模型權重與字典檔**（CDN / Hugging Face）。不加 analytics、不預設接雲端 LLM。
- **離線可用。** 模型下載後，閱讀 / OCR / 翻譯 / 查詞都要能離線跑。
- 需要 **secure context**：開發用 localhost，部署用 HTTPS（WebGPU 與 persistent storage 都需要）。
- UI 文案用繁體中文；程式碼、識別字、註解用英文。

## 架構：統一 WebGPU pipeline，只分兩層（用 `navigator.gpu` 偵測）

1. **有 WebGPU**（桌機 + 現代 Android）→ 完整 pipeline 全走 WebGPU。
2. **無 WebGPU**（老舊 Android）→ 退到 WASM execution provider，能力可縮水。

Chrome 內建 AI（Gemini Nano / Translator API）**只是桌機加分項**，永遠先確保統一棧能跑。
**Gemini Nano 不支援中文** → 中文譯文一律走 Opus-MT 或 Translator API。

## OCR Critical Rules（踩過的雷，務必遵守）

1. **先偵測再辨識。** 永遠不要把整頁丟給辨識器。先用偵測模型裁出緊密文字框，加少量 padding，再逐框辨識。
2. **manga-ocr 會幻覺。** 對空白輸入也會吐出看似真實的句子。每個區域都要用信心分數把關，過低 / 空白直接丟棄不渲染。
3. **裁切要緊。** 偵測框品質直接決定辨識品質。
4. **振假名會污染結果**，必要時依字級高度過濾行內小字 ruby。
5. **模型 lazy load + 快取**（Cache Storage / IndexedDB），分語言下載，顯示進度。日文首次 ~600MB–1GB。
6. **下載 UX：** 用 `navigator.connection` 偵測，建議 WiFi 才提示下載大模型，盡量可續傳。
7. **Android 硬體跨度大。** 鎖定中高階；低階（2–3GB RAM）走 WASM 退路。壓力主要來自 manga-ocr。

## Tech Stack（已定，不要重新討論；要換先說明理由）

- 建置：Vite + TypeScript｜UI：React 18 + Tailwind CSS（v4，`@tailwindcss/vite`）
- PWA：`vite-plugin-pwa`｜儲存：Dexie.js + 啟動 `navigator.storage.persist()`
- OCR runtime：WebGPU 為主、WASM fallback 的統一棧
  - 偵測：PaddleOCR DBNet → `onnxruntime-web`（webgpu EP，退 wasm）
  - 日文辨識：manga-ocr → `@huggingface/transformers`（VisionEncoderDecoder, `device:'webgpu'`）— **Phase 2**
- 影像前處理：canvas（之後加 OpenCV.js 做去歪斜 / 透視）＋手動裁切
- 翻譯：`@huggingface/transformers` 跑 Opus-MT（ja→zh / en→zh ONNX）；桌機 feature-detect 疊加 Translator API — **Phase 3**
- 日文斷詞：kuromoji.js（字典放 `public/`）— **Phase 4**
- 字典：sql.js + JMdict（+ JP→ZH / CC-CEDICT）— **Phase 4**
- 簡→繁：`opencc-js`（Phase 3 新增；經使用者同意，清單外但屬翻譯品質必需）

---

## 已完成：Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5

### Phase 0 — Scaffold
- Vite + TS + React 18 + Tailwind v4 + Dexie + vite-plugin-pwa 全部接好，`npm run dev` / `npm run build` 通過。
- Capability detection：[src/lib/capabilities.ts](src/lib/capabilities.ts) — `navigator.gpu` / storage / connection。
- 啟動申請 persistent storage：[src/lib/storage.ts](src/lib/storage.ts)，由 [src/AppContext.tsx](src/AppContext.tsx) 在 app 掛載時呼叫。
- Dexie schema（books / pages / bookmarks / notes / settings）：[src/db/db.ts](src/db/db.ts)。
- 路由與 layout（書庫 / 閱讀 / 筆記本）：[src/App.tsx](src/App.tsx)、[src/components/Layout.tsx](src/components/Layout.tsx)。Header 顯示 WebGPU/WASM 與儲存狀態徽章。

### Phase 1 — OCR loop v1（英文路徑打通端到端）
流程：拍照/上傳 → 手動框選裁切 → 影像強化 → PaddleOCR 偵測 → 逐框 Tesseract(eng) 辨識 → 螢幕顯示。
- 入口頁：[src/pages/Reader.tsx](src/pages/Reader.tsx)（含進度條、區域 overlay、逐框信心分數、複製全文）。
- 手動裁切 UI：[src/components/CropTool.tsx](src/components/CropTool.tsx)（指標拖曳框選，map 回原始像素）。
- 前處理：[src/lib/image/preprocess.ts](src/lib/image/preprocess.ts)（灰階 + 1%/99% 百分位對比拉伸 + 小圖放大）。**去歪斜/透視校正留到 Phase 2。**
- 偵測：[src/lib/ocr/detector.ts](src/lib/ocr/detector.ts) — `onnxruntime-web/webgpu`，EP `['webgpu','wasm']`；DBNet 後處理＝二值化 + 連通元件取 bounding box + unclip 擴張 + 用框內平均機率當信心分數把關（落實 Critical Rule #1、#2、#3）。**Phase 1 只做 axis-aligned 框，旋轉框留 Phase 2。**
- 辨識：[src/lib/ocr/recognizer.ts](src/lib/ocr/recognizer.ts) — Tesseract.js v5（`eng`），逐框辨識，信心 < 0.4 或空字串丟棄。
- 編排：[src/lib/ocr/pipeline.ts](src/lib/ocr/pipeline.ts)。
- 模型管理：[src/lib/ocr/modelManager.ts](src/lib/ocr/modelManager.ts) — fetch + 串流進度 + Cache Storage 快取（離線可用）。

### Phase 2 — 日文辨識 + 強化前處理 + 切句 + 幻覺把關
- **辨識器拆成 dispatcher**：[src/lib/ocr/recognizers/](src/lib/ocr/recognizers/) — `index.ts` 依語言分派（en→Tesseract、ja→manga-ocr）。
- **manga-ocr 日文辨識**：[recognizers/mangaOcr.ts](src/lib/ocr/recognizers/mangaOcr.ts) — `@huggingface/transformers` 的 `image-to-text`（VisionEncoderDecoder），`device:webgpu`（退 wasm）、`dtype` webgpu=fp32 / wasm=q8；下載進度用 `progress_callback` 聚合多檔。
- **三層幻覺把關**（Critical Rule #2）：① 上游只送「已偵測且信心過關」的區域；② 生成端 `max_new_tokens=64` + `no_repeat_ngram_size=3` 抑制迴圈；③ 輸出端 `looksHallucinated()` 砍空字串 / 單字重複 / 短週期重複。**日文絕不走整頁後備**（偵測失敗時直接報錯，不讓 manga-ocr 整頁幻覺）；整頁後備只允許英文 Tesseract。
- **強化前處理**：[preprocess.ts](src/lib/image/preprocess.ts) 的 `enhanceForOcr` 新增**投影輪廓去歪斜**（Otsu 二值化 + 在 ±7° 內取列投影變異數最大的角度，downscale 估角後整張旋轉）與**可選 Otsu 二值化**。仍是純 canvas，未引入 OpenCV.js。
- **區域→切句**：[src/lib/text/sentences.ts](src/lib/text/sentences.ts) — 語言感知切句（日：。！？…；英：.!? + 後接大寫/EOL），結果掛在每個 region 的 `sentences` 與 page 級 `sentences`，作為 Phase 3 逐句翻譯的輸入。
- **下載 UX**（Critical Rule #6）：Reader 顯示 manga-ocr 是否已快取（[recognizers/index.ts](src/lib/ocr/recognizers/index.ts) `isMangaOcrCached()` 掃 `transformers-cache`），在計費 / 慢速網路（`navigator.connection`）時，日文 ~440MB 下載前出現 WiFi 建議警告。

### Phase 3 — 翻譯（原文/譯文並排）
- **翻譯模組**：[src/lib/translate/](src/lib/translate/) — `index.ts` 做引擎選擇與分派，輸出對齊的 `TranslationPair[]`。
- **統一棧 Opus-MT**：[translate/opusMt.ts](src/lib/translate/opusMt.ts) — `@huggingface/transformers` 的 `translation` pipeline（MarianMT），`device:webgpu`（退 wasm），逐句翻譯 + 下載進度聚合。跨平台、本地、可離線。
- **桌機加分 Translator API**：[translate/translatorApi.ts](src/lib/translate/translatorApi.ts) — feature-detect `self.Translator`，`availability()` 檢查語言對，目標直接 `zh-Hant`（繁體）。是**疊加升級**，不可用時自動退回 Opus-MT。**Nano 不支援中文，中文只走 Translator API / Opus-MT**。
- **引擎選擇**：`resolveEngine()` — `auto`（有 Translator API 就優先，否則 Opus-MT）/ `opus-mt` / `translator-api`。Reader 結果頁有引擎下拉 + 「翻譯全部句子」按鈕 + 進度條 + **原文/譯文並排**渲染。
- **簡→繁轉換**：[translate/opencc.ts](src/lib/translate/opencc.ts) — Opus-MT 輸出簡體，用 `opencc-js`（`cn2t` 子路徑，`from:'cn' to:'tw'`）後處理成 zh-Hant。**動態 `import()` 載入**，字典 code-split 成獨立 chunk（~1MB，僅本地翻譯時才下載），不進主 bundle。Translator API 路徑本就輸出繁體，跳過此步。
- 翻譯輸入 = Phase 2 的 `PipelineResult.sentences`（逐句）。

### Phase 4 — 斷詞 + 點選查詞 + 字典 + 筆記本/書籤
- **日文斷詞**：[src/lib/jp/tokenizer.ts](src/lib/jp/tokenizer.ts) — kuromoji.js，字典在 `public/dict/*.dat.gz`（由 sync-assets 複製），lazy build。回傳 surface / reading（轉平假名）/ base（辭典原形）/ pos。**fallback**：kuromoji 載入失敗時用 `Intl.Segmenter`（granularity word, ja），只有詞界、無讀音/原形。
- **kuromoji 的 `path` polyfill**：kuromoji 的 `DictionaryLoader` 即使瀏覽器版仍 `require('path')` 做 `path.join`；在 [vite.config.ts](vite.config.ts) 用 `resolve.alias { path: 'path-browserify' }` 補上，否則會 silent 退回 Segmenter。
- **字典查詢**：[src/lib/dict/jmdict.ts](src/lib/dict/jmdict.ts) — sql.js（wasm 在 `public/sqljs/`），lazy 開啟一個 **JMdict sqlite**（URL 可配置，預設 `/dict-db/jmdict.sqlite`），查 `kanji` / `reading` / base form。**預期 schema 寫在檔案開頭註解**（`entries(id, kanji, reading, glosses)`）。DB 載不到時回 `{available:false}`，UI 顯示「字典未載入」不崩。
- **點選詞/句 UI**：[src/components/JpLookup.tsx](src/components/JpLookup.tsx) — 日文結果逐區渲染可點選詞，點擊→查 JMdict→顯示讀音/原形/釋義→「存入筆記本」。翻譯並排列每句有「＋筆記」存句子筆記（中英皆可）。
- **Dexie CRUD**：[src/db/db.ts](src/db/db.ts) 加 `addNote/listNotes/deleteNote/updateNote` 與 `addBookmark/listBookmarks/deleteBookmark`。
- **筆記本頁**：[src/pages/Notebook.tsx](src/pages/Notebook.tsx) — 列出筆記（全部／單字／句子篩選）、刪除；書籤區塊（列出/刪除）。

### Phase 5 — 兩層載入 + 下載 UX + WASM 退路 + 離線/PWA 收尾
- **中央模型登錄**：[src/lib/models/registry.ts](src/lib/models/registry.ts) — 把所有可下載資源（偵測 / manga-ocr / Opus-MT en・ja / JMdict）統一成 `isCached / download / remove` 介面，含大小與「是否大型（需 WiFi 提示）」。
- **設定頁**：[src/pages/Settings.tsx](src/pages/Settings.tsx)（路由 `/settings`）— ① 運算後端切換（自動 / 強制 WebGPU / **強制 WASM 退路**），偵測 + 生效後端顯示；② 儲存空間（永久儲存、用量/配額）；③ **分語言模型卡片**：已快取狀態、大小、下載/清除、進度條、計費網路 WiFi 警告。
- **後端覆寫貫通**：`settings.preferredEngine` 存 Dexie；[AppContext](src/AppContext.tsx) 用 `resolveBackend()` 算出 effective `backend`（auto=偵測；webgpu=有才用否則退 wasm；wasm=強制），Reader / 翻譯都改用此 effective backend。
- **Tesseract 自架**：worker + core 複製到 `public/tesseract/`（sync-assets），[tesseractEng.ts](src/lib/ocr/recognizers/tesseractEng.ts) 設 `workerPath`/`corePath` 走本地；`langPath` 預設 CDN（`tessdata.projectnaptha.com`，可 `setTesseractLangPath()` 覆寫），首次下載後由 SW 快取離線。
- **PWA 離線收尾**：[vite.config.ts](vite.config.ts) workbox `runtimeCaching`（CacheFirst）涵蓋自架資產（`/ort /dict /sqljs /tesseract /dict-db`）、bundled `/assets/*.wasm`、遠端模型 CDN（huggingface / jsdelivr / tessdata）；`globIgnores` 排除自架大檔（含 tesseract 的 base64 `*.wasm.js`）避免灌爆 precache（precache 維持 ~2.5MB）。

### Phase 6（超出原規格）— 持久化串接：書庫 → 閱讀 → 書籤
- **資料層**：[db.ts](src/db/db.ts) 加 `createBook/listBooks/getBook/countPages/listPages/getPageAt/addPage/updatePage/deleteBook/deletePage` 與 `getBookmarkAt`；`Page` 增 optional `translationPairs`（並排譯文）。封面縮圖用 [makeThumbnail](src/lib/image/preprocess.ts)。
- **存入書庫**：Reader 結果頁 `SaveToLibrary` — 選既有書或新建（書名 + 語言取自結果），把 processed 影像（JPEG）、`ocrRegions`、`fullText`、`translationPairs` 存成一頁；首頁自動產生封面。
- **書庫頁**：[Library.tsx](src/pages/Library.tsx) — 書本卡片（封面/語言/頁數）、刪除。
- **書本頁** `/book/:bookId`：[BookView.tsx](src/pages/BookView.tsx) — 頁面縮圖格、刪頁。
- **單頁閱讀** `/book/:bookId/page/:pageIndex`：[PageView.tsx](src/pages/PageView.tsx) — 影像 + 區域 overlay、上一頁/下一頁、**書籤加入/移除**、日文 `JpLookup`（筆記回連此書此頁）、並排譯文。
- **物件 URL 管理**：[useObjectUrl.ts](src/lib/useObjectUrl.ts) 統一建立/釋放 blob URL。
- 筆記本的書籤可點擊跳到該頁。

## 確切模型 ID / 來源與理由

| 用途 | 選擇 | 來源 / ID | 為什麼 |
|---|---|---|---|
| 文字偵測 | PaddleOCR **PP-OCRv4 det**（DBNet, ONNX） | `DEFAULT_DET_MODEL_URL`，預設指向 RapidOCR 的 ONNX zoo（HF `SWHL/RapidOCR`），~4.7MB | det 模型小、跨語言通用；先把「偵測在前」立起來，重量級模型留給辨識階段 |
| 英文辨識（Phase 1） | **Tesseract.js v5**（`eng`） | npm `tesseract.js`，langdata 從其 CDN 下載 | 成熟穩定、無幻覺、含自帶偵測，最適合**先打通端到端、降風險**（prompt 指定） |
| 日文辨識（Phase 2 ✅） | **manga-ocr** | `@huggingface/transformers`，預設 `Xenova/manga-ocr-base`（VisionEncoderDecoder, ~440MB）；可用 `setMangaOcrModel()` 覆寫 | prompt 指定；會幻覺，已套偵測在前 + 三層把關 |
| 翻譯（Phase 3 ✅，統一棧） | **Opus-MT** en→zh / ja→zh | `@huggingface/transformers`，預設 `Xenova/opus-mt-en-zh`、`Xenova/opus-mt-ja-zh`；`setOpusModel()` 可覆寫 | 跨平台、本地、可離線；**輸出簡體**（見限制） |
| 翻譯（Phase 3 ✅，桌機加分） | **Chrome Translator API** | `self.Translator`，目標 `zh-Hant` | 直接輸出繁體、品質升級；不可用時退 Opus-MT |
| 日文斷詞（Phase 4 ✅） | **kuromoji.js** | npm `kuromoji`，字典 `public/dict/*.dat.gz`（~15MB） | prompt 指定；提供讀音 + 辭典原形供查詞 |
| 字典引擎（Phase 4 ✅） | **sql.js** | npm `sql.js`，wasm `public/sqljs/` | 在瀏覽器跑 SQLite 查 JMdict |
| 字典資料（Phase 4，需自備） | **JMdict sqlite** | 由 `DICT_DB_URL` 指定（預設 `/dict-db/jmdict.sqlite`），schema 見 jmdict.ts | 本專案不附資料；需放符合 schema 的 sqlite |

## 已知限制 / 待辦

- **`DEFAULT_DET_MODEL_URL` 尚未實機驗證可下載。** 若 404 / CORS 失敗，pipeline 會**自動退到「整頁 Tesseract」後備**（UI 會明確標示，這是 Phase 1 唯一容許違反「先偵測再辨識」之處，且**永不**用於會幻覺的 manga-ocr）。請在實機確認 URL，或用 `setDetModelUrl()` 換成自架 / 其他鏡像。
- **ORT 與 Tesseract 的 wasm 來源**：ORT 的 wasm/jsep 由 [scripts/sync-ort.mjs](scripts/sync-ort.mjs) 在 predev/prebuild 複製到 `public/ort/`（已自架、可離線，`ort.env.wasm.wasmPaths='/ort/'`）。**Tesseract 的 core wasm + eng.traineddata 目前仍走其 CDN**，Phase 5 再自架以完全離線。
- build 產物含一個 ~23MB 的 `*.asyncify.wasm`（ORT mjs 透過 `new URL` 連帶 emit）；執行時實際走 `/ort/`，此資產不影響功能，PWA 也未 precache（>8MB 上限）；Phase 5 可再清掉。
- **`Xenova/manga-ocr-base` 尚未實機驗證可下載 / 推論。** 若該 repo id 無對應 ONNX 變體或載入失敗，日文路徑會報錯（英文路徑不受影響）；可用 `setMangaOcrModel()` 換成其他鏡像 / 自轉模型。`dtype` 也可能需依實際變體調整。
- 偵測後處理只取 axis-aligned 框，未做旋轉框 / 多邊形與直書（日文直書）處理（Phase 2 已做行內去歪斜，但直書與旋轉框仍待強化）。
- 前處理去歪斜為純 canvas 投影輪廓法（±7°）；更強的透視校正 / 去噪需 OpenCV.js（尚未引入）。
- ~~Opus-MT 輸出簡體~~ **已解決**：用 `opencc-js`（cn2t）後處理簡→繁（zh-Hant），動態載入 code-split。
- **`Xenova/opus-mt-en-zh` / `Xenova/opus-mt-ja-zh` 尚未實機驗證**；ja→zh 直翻模型若不存在，需用 `setOpusModel()` 換模型，或改 ja→en→zh 樞紐翻譯（待辦）。
- Translator API 為非標準 API，僅部分桌機 Chrome 有；型別為本專案自宣告的最小 ambient interface。
- **transformers.js 讓主 bundle 變大（~1.25MB）**，因為辨識/翻譯皆靜態 import。Phase 5 可改 `import()` 動態載入做 code-split。
- **JMdict sqlite 未隨專案附帶**：需自備一份符合 [jmdict.ts](src/lib/dict/jmdict.ts) 開頭 schema 的 `.sqlite`（放 `public/dict-db/jmdict.sqlite` 或用 `setDictDbUrl()` 指向 CDN）。沒有它時，斷詞與點選仍可用，只是查詞顯示「字典未載入」。可由 jmdict-simplified 轉成該 schema。
- ~~書籤建立 UI / OCR 結果持久化~~ **已完成**（Phase 6）：OCR/翻譯結果可存入 `books`/`pages`，書庫→書本→單頁可瀏覽，單頁可加書籤。
- **「續傳」為盡力而為**：用 Cache Storage「已下載就跳過」+ 進度顯示，並非 HTTP Range 的逐位元組續傳；下載中斷會從頭再來（remote-models runtimeCaching 有開 `rangeRequests`，但我們自家 fetch 進度流不分段續傳）。
- Tesseract 的 `eng.traineddata` 仍首次走 CDN（之後由 SW 快取離線）；要完全零外連需自備 traineddata 放本地並 `setTesseractLangPath()`。
- service worker 在 dev 關閉（`devOptions.enabled=false`）；離線行為需 `npm run build && npm run preview`（HTTPS/localhost）實測。

## 開發守則

- 每個 Phase 結束都要 `npm run dev` 跑得起來再往下；`npm run build` 也要綠。
- **要加清單以外的重型依賴，先問使用者。** 目前清單外的額外依賴：`@webgpu/types`／`@types/sql.js`／`@types/kuromoji`（純型別）、`path-browserify`（kuromoji 的 path polyfill，建置期）、`opencc-js`（簡→繁，經使用者同意、動態載入 code-split）。
- 防禦性遵守上面 Critical Rules（偵測在前、幻覺把關、裁切要緊）。
- 一個 Phase 一個 Phase 做，不要一次寫完全部。

## 規格 Phase 0–5 + 持久化串接（Phase 6）已全部完成。後續建議

1. **單頁重新翻譯/再 OCR**：PageView 目前顯示存檔當下的譯文；可加「在此頁翻譯/重辨識」並 `updatePage` 回存。
2. **bundle 瘦身**：transformers.js / 日文路徑改 `import()` 動態載入 code-split（目前主 chunk ~1.49MB）。
3. **偵測強化**：直書（日文豎排）、旋轉框；OpenCV.js 透視校正。
4. **多頁批次**：一次匯入多張、批次辨識；書本內重新排序頁面。
5. 自備 / 上架 JMdict sqlite 與 manga-ocr / Opus-MT 模型鏡像。

### 實機待驗證（遺留，皆有 graceful fallback）
- 偵測模型 URL（`DEFAULT_DET_MODEL_URL`）、manga-ocr（`Xenova/manga-ocr-base`）、Opus-MT（`Xenova/opus-mt-en-zh` / `opus-mt-ja-zh`）、JMdict sqlite（`DICT_DB_URL`）皆需真機 / 真網路確認可下載並推論；必要時用對應的 `setXxx()` 覆寫。
- 離線：`npm run build && npm run preview` 後，先連線下載各模型，再斷網實測 OCR/翻譯/查詞。
