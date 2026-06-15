#!/usr/bin/env bash
# 一键打包 AI Code Review 扩展（VSIX）
# ai-code-review CLI 不发布 npm，构建结果通过 bundle:review 打入 VSIX
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVIEW_DIR="$ROOT/cursor-pre-push-review"
VSCODE_DIR="$ROOT/cursor-pre-push-vscode"

log() { echo "[package] $*"; }
die() { echo "[package] 错误: $*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js"
command -v npm >/dev/null 2>&1 || die "未找到 npm"

if command -v vsce >/dev/null 2>&1; then
  VSCE=(vsce)
elif npx --yes @vscode/vsce --version >/dev/null 2>&1; then
  VSCE=(npx --yes @vscode/vsce)
else
  die "未找到 vsce，请执行: npm i -g @vscode/vsce"
fi

log "1/4 构建并内置 ai-code-review CLI（无需 npm 发布）…"
cd "$REVIEW_DIR"
if [[ ! -d node_modules ]]; then
  npm install
fi
npm run build

log "2/4 安装扩展依赖 …"
cd "$VSCODE_DIR"
if [[ ! -d node_modules ]]; then
  npm install
fi

log "3/4 编译扩展并打包审查 CLI …"
npm run compile
npm run bundle:review

log "4/4 生成 VSIX …"
"${VSCE[@]}" package --allow-missing-repository

VSIX_PATH="$(ls -t "$VSCODE_DIR"/*.vsix 2>/dev/null | head -1)"
if [[ -z "$VSIX_PATH" ]]; then
  die "未找到生成的 .vsix 文件"
fi

log "完成: $VSIX_PATH"
log "安装: Cursor → 扩展 → ··· → 从 VSIX 安装…"
