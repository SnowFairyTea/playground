---
title: スライドビューアー
desc: PDFやHTMLスライドをブラウザで閲覧できるデッキビューアー
tags: [tools]
order: 50
---

# スライドビューアー

PDF・HTML・PPTX 形式のスライドをブラウザで閲覧できるデッキビューアー。

## ページ構成

| ページ | URL | 役割 |
|--------|-----|------|
| セレクター | `/apps/slides/` | サムネイル付きデッキ一覧 |
| ビューアー | `/apps/slides/viewer.html?deck=<name>` | 全画面スライド表示 |

## デッキ追加の運用フロー

1. PDF を `apps/slides/decks/<名前>.pdf` に置く
2. `python3 tools/update_slides.py` を実行
3. commit & push → `/apps/slides/viewer.html?deck=<名前>.pdf` で閲覧できる

## 対応フォーマット

| 形式 | サムネイル | ビューアー |
|------|-----------|-----------|
| `.pdf` | PDF.js で1ページ目を canvas レンダリング | PDF.js ページ送り |
| `.html` | iframe を縮小プレビュー | Reveal.js（CDN） |
| `.pptx` | アイコン | Office Online embed |
