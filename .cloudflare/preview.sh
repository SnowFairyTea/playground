#!/usr/bin/env bash
set -euo pipefail

bash .cloudflare/build.sh

# Keep branch previews out of search results without changing production assets.
printf '\n/*\n  X-Robots-Tag: noindex\n' >> _site/_headers
