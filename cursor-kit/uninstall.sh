#!/usr/bin/env bash
# Remove dsh-cursor-kit and the /review skill from DSH Desktop.
#
#   ./uninstall.sh           remove plugin registration, plugin files and the /review skill
#   ./uninstall.sh --purge   also delete all saved checkpoints
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/Library/Application Support/dsh-desktop/harness}"
KIT_HOME="${DSH_CURSOR_KIT_HOME:-$HOME/.dsh-cursor-kit}"
PURGE=0
[[ "${1:-}" == "--purge" ]] && PURGE=1

for patch in "$DSH_HOME"/profiles/*/cordis.patch.yml; do
  [[ -f "$patch" ]] || continue
  if grep -q '^# dsh-cursor-kit begin' "$patch"; then
    sed -i '' '/^# dsh-cursor-kit begin/,/^# dsh-cursor-kit end/d' "$patch"
    echo "✓ 已从配置档 $(basename "$(dirname "$patch")") 移除"
  fi
done

# Only remove the skill if it is ours.
SKILL="$DSH_HOME/skills/review/SKILL.md"
if [[ -f "$SKILL" ]] && grep -q 'Cursor Bugbot' "$SKILL"; then
  rm -f "$SKILL"
  rmdir "$DSH_HOME/skills/review" 2>/dev/null || true
  echo "✓ 已移除 /review 技能"
fi

rm -f "$KIT_HOME/index.mjs" "$KIT_HOME/package.json"
if [[ $PURGE -eq 1 ]]; then
  rm -rf "$KIT_HOME/checkpoints"
  echo "✓ 已删除所有检查点"
else
  echo "检查点保留在 $KIT_HOME/checkpoints（加 --purge 可一并删除）"
fi

echo
echo "完成。请在 DSH Desktop 菜单里选择「DSH Desktop → 重启」。"
