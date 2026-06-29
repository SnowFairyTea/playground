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

## デザインシステム（Kawaii Green）

`assets/design-tokens.css` がグローバルに読み込まれ、全ページで以下の CSS 変数が使える。
新アプリでは `:root` を上書きせず、これらのトークンをそのまま使うと統一感が出る。

### 利用可能なトークン

| 変数 | 値 | 用途 |
|------|-----|------|
| `--bg` | `#ffffff` | ページ背景（白） |
| `--card` | `#ffffff` | カード・パネル背景 |
| `--surface` | `#f8fafb` | サブ背景（薄いグレー） |
| `--border` | `#e5e7eb` | ボーダー・区切り線（グレー） |
| `--accent` | `#22c55e` | メインアクセント（緑・CTA） |
| `--accent-hover` | `#16a34a` | ホバー時 |
| `--accent-light` | `#dcfce7` | 薄い緑（ホバー背景・ハイライト） |
| `--text` | `#111827` | 本文テキスト（ほぼ黒） |
| `--muted` | `#6b7280` | 補助テキスト（グレー） |
| `--link` | `#16a34a` | リンク色（緑） |
| `--shadow` | `0 4px 12px rgba(0,0,0,.08)` | カード影 |
| `--shadow-sm` | `0 1px 4px rgba(0,0,0,.05)` | 薄い影 |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,.12)` | 強い影 |
| `--radius` | `12px` | 標準角丸 |
| `--radius-sm` | `6px` | 小さい角丸 |
| `--radius-lg` | `16px` | 大きい角丸 |
| `--radius-pill` | `9999px` | ピル型（ボタン等） |
| `--font` | system-ui + Noto Sans JP | フォント |
| `--font-mono` | ui-monospace ... | 等幅フォント |

### 新アプリの推奨スタイルテンプレート

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
}

/* ページ全体のコンテナ */
.wrap { max-width: 860px; margin: 0 auto; padding: 24px; }

/* カード */
.card {
  background: var(--card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px;
  margin-bottom: 18px;
}

/* ボタン（ピル型） */
.btn {
  padding: 10px 22px;
  border-radius: var(--radius-pill);
  border: none;
  cursor: pointer;
  font-weight: 600;
  background: linear-gradient(135deg, var(--accent-light), var(--accent));
  color: var(--text);
  transition: all 0.2s ease;
}
.btn:hover {
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  transform: translateY(-1px);
}

/* トースト通知 */
.toast {
  position: fixed; top: 14px; right: 14px; z-index: 9999;
  background: var(--accent-hover); color: #fff;
  padding: 10px 12px; border-radius: var(--radius);
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
- `_includes/head-base.html` — charset, `design-tokens.css`, `style.css`, Google Fonts
- `/assets/style_artifacts.css` — 旧アプリ由来のクラス群（`container`, `header`, `toggle-btn` 等）
- `_includes/footer.html`

`style_artifacts.css` のクラスは旧来のもので、新アプリでは使わなくてよい。アプリ内 `<style>` に上記デザインテンプレートを書けば OK。
`design-tokens.css` はグローバルに読み込まれるので、`:root` の上書きなしでトークンがそのまま使える。

## ファイル構成まとめ

```
apps/
  <slug>/
    index.html   ← Jekyll front matter + HTML/CSS/JS
    README.md    ← title / desc / tags / order
_layouts/
  artifacts.html ← アプリ用レイアウト
assets/
  design-tokens.css   ← Kawaii Green デザイントークン（全ページ共通）
  style.css           ← サイト共通（ホームページ用）
  style_artifacts.css ← 旧アプリ用クラス群（新規では不要）
tools/
  update_index.py ← apps/ を走査してindex.htmlを再生成
index.html       ← トップページ（AUTO-GENERATED範囲を自動更新）
_config.yml      ← サイト設定
```
