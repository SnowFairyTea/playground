from pathlib import Path
import html
import re

APPS_DIR = Path("apps")
INDEX_FILE = Path("index.html")

START = "<!-- AUTO-GENERATED:START -->"
END = "<!-- AUTO-GENERATED:END -->"

# 表示したいカテゴリ順（無いものは後ろに回る）
CATEGORY_ORDER = ["color", "tools", "pokemon", "research", "demo", "misc"]

def parse_front_matter(text: str) -> dict:
    """
    Very small subset parser for YAML front matter:
    ---
    title: ...
    desc: ...
    tags: [a, b]
    order: 10
    ---
    """
    lines = text.splitlines()
    if len(lines) < 3 or lines[0].strip() != "---":
        return {}

    # find closing '---'
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}

    fm_lines = lines[1:end_idx]
    fm = {}
    for line in fm_lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z0-9_]+)\s*:\s*(.+)$", line)
        if not m:
            continue
        key, raw = m.group(1), m.group(2).strip()

        # list syntax: [a, b]
        if raw.startswith("[") and raw.endswith("]"):
            inner = raw[1:-1].strip()
            items = [x.strip() for x in inner.split(",") if x.strip()]
            fm[key] = items
        else:
            # strip optional quotes
            fm[key] = raw.strip("\"'")

    # normalize types
    if "order" in fm:
        try:
            fm["order"] = int(fm["order"])
        except Exception:
            fm["order"] = 9999

    if "tags" in fm and not isinstance(fm["tags"], list):
        fm["tags"] = [fm["tags"]]

    return fm

def get_meta(app_dir: Path) -> dict:
    readme = app_dir / "README.md"
    meta = {"slug": app_dir.name, "title": app_dir.name, "desc": "", "tags": ["misc"], "order": 9999}

    if not readme.exists():
        return meta

    text = readme.read_text(encoding="utf-8")
    fm = parse_front_matter(text)

    if fm.get("title"):
        meta["title"] = fm["title"]
    if fm.get("desc"):
        meta["desc"] = fm["desc"]
    if fm.get("tags"):
        meta["tags"] = fm["tags"]
    if fm.get("order") is not None:
        meta["order"] = fm["order"]

    # fallback: if no front matter, try Markdown first heading + next line
    if not parse_front_matter(text):
        lines = text.splitlines()
        if lines:
            if lines[0].startswith("#"):
                meta["title"] = lines[0].lstrip("#").strip() or meta["title"]
            if len(lines) > 1:
                meta["desc"] = lines[1].strip()

    # sanitize empty tags
    meta["tags"] = [t.strip() for t in meta["tags"] if t.strip()] or ["misc"]
    return meta

def category_key(tag: str) -> tuple:
    # sort by preferred order, then name
    if tag in CATEGORY_ORDER:
        return (CATEGORY_ORDER.index(tag), tag)
    return (len(CATEGORY_ORDER), tag)

# collect
apps = []
for p in sorted(APPS_DIR.iterdir()):
    if p.is_dir():
        meta = get_meta(p)
        apps.append(meta)

# group by primary tag (= first tag)
groups = {}
for meta in apps:
    primary = meta["tags"][0]
    groups.setdefault(primary, []).append(meta)

# sort each group
for k in groups:
    groups[k].sort(key=lambda m: (m["order"], m["title"].lower(), m["slug"]))

# sort categories
sorted_categories = sorted(groups.keys(), key=category_key)

# render HTML (simple sections)
sections = []
for cat in sorted_categories:
    safe_cat = html.escape(cat)
    items_html = []
    for m in groups[cat]:
        slug = html.escape(m["slug"])
        title = html.escape(m["title"])
        desc = html.escape(m["desc"])
        # show secondary tags (optional)
        extra_tags = [t for t in m["tags"][1:]]
        tag_str = ""
        if extra_tags:
            tag_str = " [" + ", ".join(html.escape(t) for t in extra_tags) + "]"
        line = f'    <li><a href="./apps/{slug}/">{title}</a> — {desc}{tag_str}</li>'
        items_html.append(line)

    section = "\n".join([
        f'  <h3>{safe_cat}</h3>',
        '  <ul class="apps-list">',
        *items_html,
        '  </ul>',
    ])
    sections.append(section)

generated = "\n".join(sections)

# replace in index.html
content = INDEX_FILE.read_text(encoding="utf-8")
if START not in content or END not in content:
    raise RuntimeError("index.html に AUTO-GENERATED 範囲が見つかりません。")

before, rest = content.split(START, 1)
_, after = rest.split(END, 1)
new_content = before + START + "\n" + generated + "\n  " + END + after
INDEX_FILE.write_text(new_content, encoding="utf-8")
