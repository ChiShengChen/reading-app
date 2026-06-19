#!/usr/bin/env python3
"""
Build an English->Chinese dictionary SQLite (for reading English text) from the
open ECDICT project (https://github.com/skywind3000/ECDICT), then upload to
Hugging Face.

Source: the latest ECDICT release ships a prebuilt SQLite (ecdict-sqlite-*.zip,
table `stardict`). We read it and re-emit into THIS app's schema:

    entries(word TEXT, phonetic TEXT, translation TEXT)   -- word lowercased
    index on word

Lookup (in the app) tries the clicked word + simple de-inflected forms.

Usage:
    pip install requests
    python scripts/build-ecdict-sqlite.py --out ecdict.sqlite --common   # smaller
    python scripts/build-ecdict-sqlite.py --out ecdict.sqlite            # full
    # or use a local source file you already have:
    python scripts/build-ecdict-sqlite.py --src stardict.db --out ecdict.sqlite

    hf auth login
    hf upload <your-username>/ecdict-sqlite ecdict.sqlite ecdict.sqlite
"""
import argparse
import io
import os
import re
import sqlite3
import sys
import tempfile
import zipfile

RELEASES_API = "https://api.github.com/repos/skywind3000/ECDICT/releases/latest"


def fetch_source_db(local_src: str | None) -> str:
    """Return a path to an ECDICT SQLite (stardict) file."""
    if local_src:
        return local_src
    import requests

    rel = requests.get(RELEASES_API, timeout=60).json()
    asset = next(
        (a for a in rel.get("assets", []) if re.match(r"^ecdict-sqlite.*\.zip$", a["name"])), None
    )
    if not asset:
        print("ERROR: no ecdict-sqlite*.zip asset. Assets:",
              [a["name"] for a in rel.get("assets", [])], file=sys.stderr)
        sys.exit(1)
    print(f"[1/3] Downloading {asset['name']} …")
    data = requests.get(asset["browser_download_url"], timeout=600).content
    tmpdir = tempfile.mkdtemp(prefix="ecdict-")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        db_name = next(n for n in z.namelist() if n.endswith(".db") or n.endswith(".sqlite"))
        z.extract(db_name, tmpdir)
        return os.path.join(tmpdir, db_name)


def find_source_table(con: sqlite3.Connection) -> tuple[str, set[str]]:
    """Find the table that has 'word' + 'translation' columns; return (table, cols)."""
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    for t in tables:
        cols = {r[1] for r in con.execute(f"PRAGMA table_info({t})")}
        if "word" in cols and "translation" in cols:
            return t, cols
    print(f"ERROR: no table with word+translation columns. Tables: {tables}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ecdict.sqlite")
    ap.add_argument("--src", help="local ECDICT stardict .db/.sqlite (skip download)")
    ap.add_argument("--common", action="store_true", help="keep only frequency-ranked words")
    ap.add_argument("--max-rank", type=int, default=25000)
    args = ap.parse_args()

    src = fetch_source_db(args.src)
    scon = sqlite3.connect(src)
    table, cols = find_source_table(scon)
    has_bnc, has_frq = "bnc" in cols, "frq" in cols
    sel = "word, phonetic, translation"
    if has_bnc:
        sel += ", bnc"
    if has_frq:
        sel += ", frq"
    print(f"[2/3] Reading `{table}` and building {args.out} …")

    if os.path.exists(args.out):
        os.remove(args.out)
    dcon = sqlite3.connect(args.out)
    dcur = dcon.cursor()
    dcur.execute("CREATE TABLE entries (word TEXT, phonetic TEXT, translation TEXT)")

    rows, n = [], 0
    for row in scon.execute(f"SELECT {sel} FROM {table}"):
        word = (row[0] or "").strip()
        phonetic = (row[1] or "").strip()
        translation = (row[2] or "").strip()
        if not word or not translation:
            continue
        if args.common:
            idx = 3
            bnc = row[idx] if has_bnc else 0
            idx += 1 if has_bnc else 0
            frq = row[idx] if has_frq else 0
            bnc = bnc or 0
            frq = frq or 0
            if not ((0 < bnc <= args.max_rank) or (0 < frq <= args.max_rank)):
                continue
        rows.append((word.lower(), phonetic, translation))
        n += 1
        if len(rows) >= 50000:
            dcur.executemany("INSERT INTO entries (word, phonetic, translation) VALUES (?,?,?)", rows)
            rows = []
    if rows:
        dcur.executemany("INSERT INTO entries (word, phonetic, translation) VALUES (?,?,?)", rows)

    print("[3/3] Indexing + compacting …")
    dcur.execute("CREATE INDEX idx_entries_word ON entries(word)")
    dcon.commit()
    dcur.execute("VACUUM")
    dcon.commit()
    dcon.close()
    scon.close()

    size_mb = os.path.getsize(args.out) / (1024 * 1024)
    print(f"\nDone: {args.out}  ({n} rows, {size_mb:.1f} MB)")
    print(
        "Upload (public), then it works (default URL points at ms57rd/ecdict-sqlite):\n"
        "  hf auth login\n"
        f"  hf upload <your-username>/ecdict-sqlite {args.out} ecdict.sqlite\n"
        "  URL = https://huggingface.co/<your-username>/ecdict-sqlite/resolve/main/ecdict.sqlite"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
