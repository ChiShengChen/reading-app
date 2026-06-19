#!/usr/bin/env python3
"""
One-off remedy: add the missing tokenizer.json + preprocessor_config.json to an
already-uploaded manga-ocr ONNX repo (the big ONNX files stay as-is).

Why needed: manga-ocr's tokenizer is a BertJapaneseTokenizer (MeCab) with no
fast tokenizer.json. MeCab is only used to ENCODE text; OCR only DECODES
ids->characters, which just needs the vocab — so we build a plain WordPiece
tokenizer.json from vocab.txt.

Usage:
    pip install transformers huggingface_hub
    hf auth login          # write token
    python scripts/add-manga-ocr-tokenizer.py --dst <your-username>/manga-ocr-base-ONNX
"""
import argparse
import shutil
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="kha-white/manga-ocr-base")
    ap.add_argument("--dst", required=True, help="your uploaded repo, e.g. you/manga-ocr-base-ONNX")
    args = ap.parse_args()

    from huggingface_hub import hf_hub_download, upload_folder
    from transformers import BertTokenizerFast

    out = Path("manga-ocr-extra")
    out.mkdir(exist_ok=True)

    # ViT image preprocessor (verbatim).
    shutil.copy2(hf_hub_download(args.src, "preprocessor_config.json"), out / "preprocessor_config.json")

    # Decode-only fast WordPiece tokenizer.json from the original vocab.
    vocab_path = hf_hub_download(args.src, "vocab.txt")
    BertTokenizerFast(
        vocab_file=vocab_path,
        do_lower_case=False,
        strip_accents=False,
        tokenize_chinese_chars=True,
        unk_token="[UNK]",
        sep_token="[SEP]",
        pad_token="[PAD]",
        cls_token="[CLS]",
        mask_token="[MASK]",
    ).save_pretrained(str(out))

    print("Uploading:", [p.name for p in out.iterdir()])
    upload_folder(repo_id=args.dst, folder_path=str(out))
    print("Done. Now the repo has tokenizer.json + preprocessor_config.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
