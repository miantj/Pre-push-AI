import * as fs from "fs";
import * as path from "path";
import { ensureGitignoreEntries } from "./gitignoreUpdater";
import { HOOK_RUNNER_REL } from "../shared/workspacePaths";
import { API_KEY_ENV_REL } from "../settings/settingsProvider";

export { HOOK_RUNNER_REL };

export function hookRunnerPath(repoRoot: string): string {
  return path.join(repoRoot, HOOK_RUNNER_REL);
}

function shellQuoteForSh(value: string): string {
  return String(value).replace(/'/g, `'\\''`);
}

/** 写入本机专用 runner（gitignore），供 husky / git hook 以可移植方式调用 */
export function writeHookRunnerScript(
  repoRoot: string,
  cliPath: string,
  fallbackNodeBin?: string,
  useElectronFallback = false
): boolean {
  const runnerPath = hookRunnerPath(repoRoot);
  const envFile = path.join(repoRoot, API_KEY_ENV_REL);
  const fallbackNode = fallbackNodeBin?.trim() ?? "";
  const electronFallbackBlock =
    fallbackNode && useElectronFallback
      ? [
          'if [ -z "$NODE_BIN" ] && [ -x "$FALLBACK_NODE" ]; then',
          "  NODE_BIN=\"$FALLBACK_NODE\"",
          "  export ELECTRON_RUN_AS_NODE=1",
          "fi",
        ].join("\n")
      : fallbackNode
        ? [
            'if [ -z "$NODE_BIN" ] && [ -x "$FALLBACK_NODE" ]; then',
            "  NODE_BIN=\"$FALLBACK_NODE\"",
            "fi",
          ].join("\n")
        : "";

  const script = [
    "#!/bin/sh",
    "# AI Code Review 本地 runner（扩展自动生成，勿提交）",
    "set -e",
    'NODE_BIN="$(command -v node 2>/dev/null || true)"',
    fallbackNode ? `FALLBACK_NODE='${shellQuoteForSh(fallbackNode)}'` : "",
    electronFallbackBlock,
    'if [ -z "$NODE_BIN" ]; then',
    '  echo "[ai-code-review] 未找到 node，审查依赖缺失" >&2',
    "  exit 1",
    "fi",
    `CLI_PATH='${shellQuoteForSh(cliPath)}'`,
    `ENV_FILE='${shellQuoteForSh(envFile)}'`,
    'if [ ! -f "$CLI_PATH" ]; then',
    '  echo "[ai-code-review] CLI 不存在，审查依赖缺失: $CLI_PATH" >&2',
    "  exit 1",
    "fi",
    'if [ -f "$ENV_FILE" ]; then',
    "  set -a",
    "  # shellcheck disable=SC1090",
    '  . "$ENV_FILE"',
    "  set +a",
    "fi",
    'is_skip_flag() {',
    '  case "$1" in 1|true|yes|TRUE|YES) return 0 ;; esac',
    "  return 1",
    "}",
    'if is_skip_flag "$SKIP_REVIEW"; then',
    '  echo "[ai-code-review] 已跳过审查（SKIP_REVIEW=1）" >&2',
    "  exit 0",
    "fi",
    "export AI_CODE_REVIEW_FROM_HOOK=1",
    'export PATH="$HOME/.local/bin:$PATH"',
    'exec "$NODE_BIN" "$CLI_PATH" "$@"',
  ]
    .filter(Boolean)
    .join("\n")
    .concat("\n");

  try {
    fs.mkdirSync(path.dirname(runnerPath), { recursive: true });
    fs.writeFileSync(runnerPath, script, { encoding: "utf8", mode: 0o755 });
    ensureGitignoreEntries(repoRoot);
    return true;
  } catch {
    return false;
  }
}

export function removeHookRunnerScript(repoRoot: string): void {
  const runnerPath = hookRunnerPath(repoRoot);
  try {
    if (fs.existsSync(runnerPath)) fs.unlinkSync(runnerPath);
  } catch {
    // ignore
  }
}
