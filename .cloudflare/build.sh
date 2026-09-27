#!/usr/bin/env bash
set -euo pipefail

# Japanese asset filenames require a UTF-8 filesystem locale in Workers Builds.
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export JEKYLL_ENV=production

bundle install
bundle exec jekyll build
