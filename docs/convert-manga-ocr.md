# 轉換 manga-ocr 成完整 ONNX 並上架到你的 Hugging Face

目的：產生一份 **Transformers.js 可直接載入** 的 manga-ocr ONNX（含
`onnx/decoder_model_merged.onnx` 與 tokenizer），解決「目前沒有完整公開模型」的缺口。
轉好上傳後，在 App 設定頁貼上 repo id 即可啟用日文辨識。

> 這一步需要在**你自己的電腦**（或 Colab）跑 Python，並用**你的 HF write token** 上傳。
> 我無法用你的帳號登入，所以由你執行；指令可直接複製。

## 需求
- Python 3.10+，約 3–4 GB 暫存空間
- 一個 Hugging Face 帳號，以及一組 **write** 權限的 token（https://huggingface.co/settings/tokens）

## 步驟

```bash
# 1) 環境
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install "optimum[exporters,onnxruntime]" transformers torch onnx onnxruntime huggingface_hub

# 2) 轉換（會自動下載 kha-white/manga-ocr-base 並輸出到 ./manga-ocr-onnx）
python scripts/convert-manga-ocr.py --out manga-ocr-onnx

# 3) 確認輸出（必須看到這 4 個檔）
ls manga-ocr-onnx/onnx
#   encoder_model.onnx              decoder_model_merged.onnx
#   encoder_model_quantized.onnx    decoder_model_merged_quantized.onnx
ls manga-ocr-onnx
#   config.json tokenizer.json vocab.txt preprocessor_config.json …

# 4) 登入並上傳到你的帳號（把 <your-username> 換成你的）
hf auth login        # 貼上 write token
hf upload <your-username>/manga-ocr-base-ONNX manga-ocr-onnx .
```

建立 repo 時若被問公開/私有，選 **public**（App 是純前端、用匿名下載；私有 repo 無法匿名抓）。

### 若你已上傳但缺 tokenizer.json / preprocessor_config.json
manga-ocr 的 tokenizer 是 MeCab 版 `BertJapaneseTokenizer`，沒有 fast `tokenizer.json`、
也無法自動轉換；但 MeCab 只用於「編碼」，OCR 只需「解碼」(id→字)，所以用 vocab.txt
建一份 WordPiece `tokenizer.json` 即可。最新 `convert-manga-ocr.py` 已內建此步；
若你之前上傳的版本缺這兩個小檔，**不用重傳大檔**，只要補上：

```bash
python scripts/add-manga-ocr-tokenizer.py --dst <your-username>/manga-ocr-base-ONNX
```

## 在 App 啟用
本 App 預設已指向 `ms57rd/manga-ocr-base-ONNX`，若那是你的 repo 就直接可用。
否則打開 https://chishengchen.github.io/reading-app/ → **設定 → 進階 → 日文辨識模型**，
貼上 `you/manga-ocr-base-ONNX` → 儲存。回設定頁的「日文辨識」按下載，
之後日文 OCR 就能用（手機走 WASM 用 `_quantized` 版，桌機 WebGPU 用 fp32 版）。

## 疑難排解
- **`ValueError: ... decoder ... is bert which does not need past key values`**：已修正。
  manga-ocr 的 decoder 是 BERT、沒有 KV cache，所以腳本改用 `image-to-text`（非
  `-with-past`），並把 `decoder_model.onnx` 複製成 `decoder_model_merged.onnx`
  （Transformers.js 只會餵該 session 實際宣告的輸入，無 cache 也能跑）。請 `git pull` 取得最新腳本再跑。
- **缺檔**：確認 `manga-ocr-onnx/onnx/` 內有 encoder/decoder_model_merged（+ _quantized）四個檔。
- **下載很慢/很大**：fp32+q8 約數百 MB。只想先驗證可加 `--skip-quantize`（但手機 WASM 會很慢）。
- **CORS / 401**：repo 要 public；URL 形如 `https://huggingface.co/<id>/resolve/main/...`。
