#!/usr/bin/env python3
"""Scan apps/slides/decks/ and regenerate manifest.json."""
import json
import re
from pathlib import Path

DECKS_DIR = Path(__file__).parent.parent / "apps" / "slides" / "decks"
MANIFEST  = DECKS_DIR / "manifest.json"
SUPPORTED = {".pdf": "pdf", ".html": "html", ".pptx": "pptx"}


def slug_to_title(stem: str) -> str:
    words = stem.replace("-", " ").replace("_", " ").split()
    result = []
    for w in words:
        ascii_alpha = [c for c in w if c.isascii() and c.isalpha()]
        if not ascii_alpha or all(c.isupper() for c in ascii_alpha):
            result.append(w)
        else:
            result.append(w.capitalize())
    return " ".join(result)


def html_title(path: Path) -> str:
    text = path.read_text(encoding="utf-8", errors="ignore")
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if m:
        tm = re.search(r"^title:\s*(.+)$", m.group(1), re.MULTILINE)
        if tm:
            return tm.group(1).strip().strip("\"'")
    return slug_to_title(path.stem)


def main():
    if not DECKS_DIR.exists():
        DECKS_DIR.mkdir(parents=True)

    entries = []
    for path in sorted(DECKS_DIR.iterdir()):
        if path.name == "manifest.json":
            continue
        t = SUPPORTED.get(path.suffix.lower())
        if t is None:
            continue
        title = html_title(path) if t == "html" else slug_to_title(path.stem)
        entries.append({"file": path.name, "title": title, "type": t})

    MANIFEST.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifest.json に {len(entries)} 件を書き込みました → {MANIFEST}")


if __name__ == "__main__":
    main()
