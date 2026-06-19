#!/usr/bin/env python3
"""
Convert kha-white/manga-ocr-base into a COMPLETE Transformers.js-ready ONNX
repo (the layout this app needs):

    <out>/
      config.json  generation_config.json  preprocessor_config.json
      tokenizer.json  tokenizer_config.json  vocab.txt  special_tokens_map.json
      onnx/
        encoder_model.onnx              decoder_model_merged.onnx            (fp32  -> dtype "fp32", WebGPU)
        encoder_model_quantized.onnx    decoder_model_merged_quantized.onnx  (uint8 -> dtype "q8",  WASM)

Why: the public manga-ocr ONNX repos are missing `decoder_model_merged.onnx`
(required by Transformers.js Vision2Seq) and/or the tokenizer. This produces a
complete one you upload to your own Hugging Face account.

Usage:
    pip install "optimum[exporters,onnxruntime]" transformers torch onnx onnxruntime huggingface_hub
    python scripts/convert-manga-ocr.py --out manga-ocr-onnx
    # then upload (see docs/convert-manga-ocr.md)
"""
import argparse
import shutil
import sys
from pathlib import Path

ROOT_FILES = [
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
    "special_tokens_map.json",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model_id", default="kha-white/manga-ocr-base")
    ap.add_argument("--out", default="manga-ocr-onnx")
    ap.add_argument("--skip-quantize", action="store_true", help="fp32 only (smaller repo, WASM will be slow)")
    args = ap.parse_args()

    out = Path(args.out)
    raw = out / "_raw"
    onnx_dir = out / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    # 1) Export to ONNX via optimum. manga-ocr's decoder is BERT (NO key-value
    # cache), so the "*-with-past" task is invalid here — use plain image-to-text,
    # which yields encoder_model.onnx + decoder_model.onnx.
    from optimum.exporters.onnx import main_export

    print(f"[1/4] Exporting {args.model_id} to ONNX (this downloads the model)…")
    main_export(
        model_name_or_path=args.model_id,
        output=str(raw),
        task="image-to-text",
    )

    encoder = raw / "encoder_model.onnx"
    decoder = raw / "decoder_model.onnx"
    if not encoder.exists() or not decoder.exists():
        print(
            f"ERROR: expected {encoder.name} and {decoder.name} in {raw}.\n"
            f"Found: {[p.name for p in raw.glob('*.onnx')]}",
            file=sys.stderr,
        )
        return 1

    # 2) Arrange onnx/ (fp32). Transformers.js Vision2Seq always loads a file
    # named `decoder_model_merged.onnx`; for a no-cache decoder it just feeds the
    # inputs the session declares, so the plain decoder works under that name.
    print("[2/4] Arranging onnx/ folder (fp32)…")
    shutil.copy2(encoder, onnx_dir / "encoder_model.onnx")
    shutil.copy2(decoder, onnx_dir / "decoder_model_merged.onnx")

    # 3) Quantize to uint8 -> the "_quantized" files the WASM path (dtype q8) uses.
    if not args.skip_quantize:
        print("[3/4] Quantizing to q8 (uint8) for the WASM path…")
        from onnxruntime.quantization import quantize_dynamic, QuantType

        for name in ("encoder_model", "decoder_model_merged"):
            quantize_dynamic(
                model_input=str(onnx_dir / f"{name}.onnx"),
                model_output=str(onnx_dir / f"{name}_quantized.onnx"),
                weight_type=QuantType.QUInt8,
            )
    else:
        print("[3/4] Skipping quantization (fp32 only).")

    # 4) Copy config/tokenizer/preprocessor to the repo root; guarantee tokenizer.json.
    print("[4/4] Copying config + tokenizer + preprocessor to repo root…")
    for f in ROOT_FILES:
        src = raw / f
        if src.exists():
            shutil.copy2(src, out / f)
    # Re-save tokenizer to guarantee a fast tokenizer.json exists.
    try:
        from transformers import AutoTokenizer

        AutoTokenizer.from_pretrained(args.model_id).save_pretrained(str(out))
    except Exception as e:  # noqa: BLE001
        print(f"WARN: tokenizer re-save failed ({e}); relying on copied files.")

    shutil.rmtree(raw, ignore_errors=True)

    print("\nDone. Contents of", out)
    for p in sorted(out.rglob("*")):
        if p.is_file():
            print(f"  {p.relative_to(out)}  ({p.stat().st_size // 1024} KB)")
    print(
        "\nNext: upload to your Hugging Face account, e.g.\n"
        "  huggingface-cli login\n"
        f"  huggingface-cli upload <your-username>/manga-ocr-base-ONNX {out} .\n"
        "Then paste that repo id into the app: 設定 → 進階 → 日文辨識模型。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
