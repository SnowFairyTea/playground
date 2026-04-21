# Playground — Claude Reference

GitHub Pages (Jekyll) の個人デモサイト。サーバーサイド処理なし、静的HTML/CSS/JSのみ。
PRの文章は日本語を使用すること

## 新しいアプリを追加する手順

1. `apps/<slug>/index.html` を作成
2. `apps/<slug>/README.md` を作成（メタ情報）
3. `python3 tools/update_index.py` を実行 → `index.html` が自動更新される

## apps/<slug>/index.html の構造

```html
---
layout: artifacts
title: "アプリ名"
permalink: /apps/<slug>/
---

<style>
  /* アプリ固有スタイル（後述のデザインパターン参照） */
</style>

<!-- HTML -->

<script>
  /* JS */
</script>
```

## apps/<slug>/README.md のフロントマター

```yaml
---
title: アプリ名
desc: 一行説明
tags: [<category>]
order: 10
---
```

**tags に指定できるカテゴリ（表示順）:**
`Poke-Controller` → `MATLAB` → `color` → `tools` → `pokemon` → `research` → `demo` → `misc` → `archive`

上記以外のタグを使うと末尾に追加される。

## デザインパターン（推奨スタイル）

新アプリは `rgb_color_picker` などと同じトークンを使うと統一感が出る。

```css
:root {
  --bg: #f3f4f6;
  --card: #fff;
  --text: #111827;
  --muted: #6b7280;
  --shadow: 0 4px 10px rgba(0,0,0,.08);
  --accent: #3b82f6;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans JP", sans-serif;
  background: var(--bg); color: var(--text);
}

/* ページ全体のコンテナ */
.wrap { max-width: 860px; margin: 0 auto; padding: 24px; }

/* カード */
.card {
  background: var(--card); border-radius: 12px;
  box-shadow: var(--shadow); padding: 20px; margin-bottom: 18px;
}

/* トースト通知 */
.toast {
  position: fixed; top: 14px; right: 14px; z-index: 9999;
  background: #16a34a; color: #fff;
  padding: 10px 12px; border-radius: 10px;
  box-shadow: var(--shadow); display: none; font-size: 14px;
}
```

### トースト通知のJS

```js
function showToast(msg, ok = true) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.background = ok ? "#16a34a" : "#dc2626";
  el.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.style.display = "none"; }, 2000);
}
```

### クリップボードコピーのJS

```js
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${text} をコピーしました！`);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    showToast(`${text} をコピーしました！`);
  }
}
```

## layout: artifacts について

`_layouts/artifacts.html` が使われる。内部で以下を自動インクルード:
- `_includes/head-base.html` — charset, `style.css`, Google Fonts
- `/assets/style_artifacts.css` — 旧アプリ由来のグリーン系クラス群（`container`, `header`, `toggle-btn` 等）
- `_includes/footer.html`

`style_artifacts.css` のクラスは旧来のもので、新アプリでは使わなくてよい。アプリ内 `<style>` に上記デザインパターンを書けば OK。

## ファイル構成まとめ

```
apps/
  <slug>/
    index.html   ← Jekyll front matter + HTML/CSS/JS
    README.md    ← title / desc / tags / order
_layouts/
  artifacts.html ← アプリ用レイアウト
assets/
  style.css           ← サイト共通
  style_artifacts.css ← 旧アプリ用（新規では不要）
tools/
  update_index.py ← apps/ を走査してindex.htmlを再生成
index.html       ← トップページ（AUTO-GENERATED範囲を自動更新）
_config.yml      ← サイト設定
```
