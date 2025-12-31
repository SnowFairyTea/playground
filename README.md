# playground

## ページリンク
https://snowfairytea.dev/

## 技術情報

このサイトは GitHub Pages + Jekyll で構築されており、カスタムドメイン `snowfairytea.dev` を使用しています。

### アセット参照について

カスタムドメインを使用する場合、`_config.yml` の `baseurl` は空文字列 (`""`) に設定する必要があります。
すべてのアセット（CSS、画像など）への参照には Jekyll の `relative_url` フィルタを使用しています。

**例:**
```liquid
<link rel="stylesheet" href="{{ '/assets/style.css' | relative_url }}">
```

これにより、カスタムドメインと GitHub Pages のサブディレクトリの両方で正しく動作します。
