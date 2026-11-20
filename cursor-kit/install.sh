#!/usr/bin/env bash
# Install dsh-cursor-kit (and the /review skill) into DSH Desktop on macOS.
#
#   ./install.sh               install plugin + /review skill
#   ./install.sh --no-review   install the plugin only
#
# Environment overrides (mostly for testing):
#   DSH_HOME             DSH harness home (default: ~/Library/Application Support/dsh-desktop/harness)
#   DSH_CURSOR_KIT_HOME  where the plugin lives   (default: ~/.dsh-cursor-kit)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/Library/Application Support/dsh-desktop/harness}"
KIT_HOME="${DSH_CURSOR_KIT_HOME:-$HOME/.dsh-cursor-kit}"
WITH_REVIEW=1
[[ "${1:-}" == "--no-review" ]] && WITH_REVIEW=0

if [[ ! -d "$DSH_HOME/profiles" ]]; then
  echo "找不到 DSH Desktop 的配置目录：$DSH_HOME/profiles" >&2
  echo "请先安装并至少打开一次 DSH Desktop。" >&2
  exit 1
fi
command -v git >/dev/null || { echo "需要 git（可运行 xcode-select --install 安装）" >&2; exit 1; }

# 1. Copy the plugin to a stable location outside the app bundle.
mkdir -p "$KIT_HOME"
cp "$HERE/index.mjs" "$KIT_HOME/index.mjs"
cp "$HERE/package.json" "$KIT_HOME/package.json"
echo "✓ 插件已复制到 $KIT_HOME"

# 2. Register it in every DSH profile (0.13 uses "web", 0.14+ uses "desktop").
URL="file://${KIT_HOME// /%20}/index.mjs"
STAMP="$(date +%Y%m%d-%H%M%S)"
found=0
for patch in "$DSH_HOME"/profiles/*/cordis.patch.yml; do
  [[ -f "$patch" ]] || continue
  found=1
  profile="$(basename "$(dirname "$patch")")"
  cp "$patch" "$KIT_HOME/cordis.patch.yml.$profile.backup-$STAMP"
  # Drop an older copy of our block, then append a fresh one.
  sed -i '' '/^# dsh-cursor-kit begin/,/^# dsh-cursor-kit end/d' "$patch"
  cat >> "$patch" <<EOF
# dsh-cursor-kit begin — Cursor-style /checkpoints, /rewind and lint-after-edit.
# To uninstall: run cursor-kit/uninstall.sh, or delete this block and restart DSH Desktop.
- insert:
    - id: cursor-kit
      name: "$URL"
      config:
        checkpoints: true
        lint: true
# dsh-cursor-kit end
EOF
  echo "✓ 已注册到配置档：$profile（原文件备份在 $KIT_HOME）"
done
if [[ $found -eq 0 ]]; then
  echo "没有找到任何 profiles/*/cordis.patch.yml，未注册插件。" >&2
  exit 1
fi

# 3. The /review skill.
if [[ $WITH_REVIEW -eq 1 ]]; then
  mkdir -p "$DSH_HOME/skills/review"
  cp "$REPO/skills/review/SKILL.md" "$DSH_HOME/skills/review/SKILL.md"
  echo "✓ /review 技能已安装到 $DSH_HOME/skills/review"
fi

echo
echo "完成。请在 DSH Desktop 菜单里选择「DSH Desktop → 重启」让插件生效。"
echo "然后在输入框里输入 /checkpoints、/rewind 或 /review 试试。"
