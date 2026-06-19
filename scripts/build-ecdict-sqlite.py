#!/usr/bin/env python3
"""
Build an English->Chinese dictionary SQLite (for reading English text) from the
open ECDICT project (https://github.com/skywind3000/ECDICT), then upload to
Hugging Face.

App schema (see src/lib/dict/ecdict.ts):
    entries(word TEXT, phonetic TEXT, translation TEXT)   -- word is lowercased
    index on word
Lookup tries the clicked word + simple de-inflected forms (plurals, -ed/-ing…).

Usage:
    pip install requests
    python scripts/build-ecdict-sqlite.py --out ecdict.sqlite --common   # ~common words, smaller
    python scripts/build-ecdict-sqlite.py --out ecdict.sqlite            # full (~big)

    hf auth login
    hf upload <your-username>/ecdict-sqlite ecdict.sqlite ecdict.sqlite
    # URL = https://huggingface.co/<your-username>/ecdict-sqlite/resolve/main/ecdict.sqlite
"""
import argparse
import csv
import io
import os
import re
import sqlite3
import sys
import zipfile

RELEASES_API = "https://api.github.com/repos/skywind3000/ECDICT/releases/latest"
csv.field_size_limit(10_000_000)


def get_csv_bytes(local_csv: str | None) -> bytes:
    if local_csv:
        with open(local_csv, "rb") as f:
            return f.read()
    import requests

    rel = requests.get(RELEASES_API, timeout=60).json()
    asset = next((a for a in rel.get("assets", []) if re.match(r"^ecdict-csv.*\.zip$", a["name"])), None)
    if not asset:
        print("ERROR: no ecdict-csv*.zip asset. Assets:", [a["name"] for a in rel.get("assets", [])], file=sys.stderr)
        sys.exit(1)
    print(f"[1/3] Downloading {asset['name']} …")
    data = requests.get(asset["browser_download_url"], timeout=600).content
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        return z.read(name)


def rank(v: str) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ecdict.sqlite")
    ap.add_argument("--csv", help="use a local ecdict.csv instead of downloading")
    ap.add_argument("--common", action="store_true", help="keep only frequency-ranked words (smaller)")
    ap.add_argument("--max-rank", type=int, default=25000, help="--common frequency cutoff (bnc/frq)")
    args = ap.parse_args()

    raw = get_csv_bytes(args.csv)
    print("[2/3] Parsing CSV + building", args.out, "…")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8")))

    con = sqlite3.connect(args.out)
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS entries")
    cur.execute("CREATE TABLE entries (word TEXT, phonetic TEXT, translation TEXT)")

    rows, n = [], 0
    for r in reader:
        word = (r.get("word") or "").strip()
        translation = (r.get("translation") or "").strip()
        if not word or not translation:
            continue
        if args.common:
            bnc, frq = rank(r.get("bnc")), rank(r.get("frq"))
            ranked = (0 < bnc <= args.max_rank) or (0 < frq <= args.max_rank)
            if not ranked:
                continue
        rows.append((word.lower(), (r.get("phonetic") or "").strip(), translation))
        n += 1
        if len(rows) >= 50000:
            cur.executemany("INSERT INTO entries (word, phonetic, translation) VALUES (?,?,?)", rows)
            rows = []
    if rows:
        cur.executemany("INSERT INTO entries (word, phonetic, translation) VALUES (?,?,?)", rows)

    print("[3/3] Indexing + compacting …")
    cur.execute("CREATE INDEX idx_entries_word ON entries(word)")
    con.commit()
    cur.execute("VACUUM")
    con.commit()
    con.close()

    size_mb = os.path.getsize(args.out) / (1024 * 1024)
    print(f"\nDone: {args.out}  ({n} rows, {size_mb:.1f} MB)")
    print(
        "Upload (public), then paste the URL in 設定→進階→英文字典:\n"
        "  hf auth login\n"
        f"  hf upload <your-username>/ecdict-sqlite {args.out} ecdict.sqlite\n"
        "  URL = https://huggingface.co/<your-username>/ecdict-sqlite/resolve/main/ecdict.sqlite"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
