#!/usr/bin/env python3
"""
Build a JMdict SQLite that matches this app's schema, from the public
jmdict-simplified release (https://github.com/scriptin/jmdict-simplified),
then (optionally) you upload it to Hugging Face.

App schema (see src/lib/dict/jmdict.ts):
    entries(id INTEGER PRIMARY KEY, kanji TEXT, reading TEXT, glosses TEXT)
    index on kanji, index on reading
Lookup: WHERE kanji = ?term OR reading = ?term OR kanji = ?baseform

Rows emitted per JMdict word:
  - one row per KANJI form  (kanji=<form>, reading=<primary kana>, glosses)
  - one row per KANA  form  (kanji=NULL,  reading=<kana>,         glosses)
so a click on either a kanji surface or a kana reading finds the entry.
Glosses are English (JMdict eng), one numbered sense per line.

Usage:
    pip install requests
    python scripts/build-jmdict-sqlite.py --out jmdict.sqlite        # full dict
    python scripts/build-jmdict-sqlite.py --out jmdict.sqlite --common  # smaller, common words only

    # then upload to your Hugging Face (public):
    hf auth login
    hf upload <your-username>/jmdict-sqlite jmdict.sqlite jmdict.sqlite
"""
import argparse
import io
import json
import re
import sqlite3
import sys
import zipfile

RELEASES_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"


def find_asset(common: bool):
    import requests

    rel = requests.get(RELEASES_API, timeout=60).json()
    # full:   jmdict-eng-3.x.y.json.zip
    # common: jmdict-eng-common-3.x.y.json.zip
    want = re.compile(
        r"^jmdict-eng-common-\d.*\.json\.zip$" if common else r"^jmdict-eng-\d.*\.json\.zip$"
    )
    for a in rel.get("assets", []):
        if want.match(a["name"]):
            return a["name"], a["browser_download_url"]
    print("ERROR: could not find a jmdict-eng .json.zip asset in the latest release.", file=sys.stderr)
    print("Assets:", [a["name"] for a in rel.get("assets", [])], file=sys.stderr)
    sys.exit(1)


def load_words(common: bool):
    import requests

    name, url = find_asset(common)
    print(f"[1/3] Downloading {name} …")
    data = requests.get(url, timeout=600).content
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        json_name = next(n for n in z.namelist() if n.endswith(".json"))
        print(f"      Parsing {json_name} …")
        with z.open(json_name) as f:
            return json.load(f)["words"]


def build_glosses(senses) -> str:
    lines = []
    for i, sense in enumerate(senses, 1):
        texts = [g["text"] for g in sense.get("gloss", []) if g.get("lang", "eng") == "eng"]
        if texts:
            lines.append(f"{i}. " + ", ".join(texts))
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="jmdict.sqlite")
    ap.add_argument("--common", action="store_true", help="common words only (smaller file)")
    args = ap.parse_args()

    words = load_words(args.common)
    print(f"[2/3] Building {args.out} from {len(words)} entries …")

    con = sqlite3.connect(args.out)
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS entries")
    cur.execute(
        "CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "kanji TEXT, reading TEXT, glosses TEXT)"
    )

    rows = []
    for w in words:
        kana = [k["text"] for k in w.get("kana", [])]
        kanji = [k["text"] for k in w.get("kanji", [])]
        glosses = build_glosses(w.get("sense", []))
        if not glosses:
            continue
        primary_reading = kana[0] if kana else None
        for k in kanji:
            rows.append((k, primary_reading, glosses))
        for r in kana:
            rows.append((None, r, glosses))
        if len(rows) >= 50000:
            cur.executemany("INSERT INTO entries (kanji, reading, glosses) VALUES (?,?,?)", rows)
            rows = []
    if rows:
        cur.executemany("INSERT INTO entries (kanji, reading, glosses) VALUES (?,?,?)", rows)

    print("[3/3] Indexing + compacting …")
    cur.execute("CREATE INDEX idx_entries_kanji ON entries(kanji)")
    cur.execute("CREATE INDEX idx_entries_reading ON entries(reading)")
    con.commit()
    cur.execute("VACUUM")
    con.commit()
    n = cur.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    con.close()

    import os

    size_mb = os.path.getsize(args.out) / (1024 * 1024)
    print(f"\nDone: {args.out}  ({n} rows, {size_mb:.1f} MB)")
    print(
        "Upload (public), then paste the URL in 設定→進階→日文字典:\n"
        "  hf auth login\n"
        "  hf upload <your-username>/jmdict-sqlite "
        f"{args.out} jmdict.sqlite\n"
        "  URL = https://huggingface.co/<your-username>/jmdict-sqlite/resolve/main/jmdict.sqlite"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
