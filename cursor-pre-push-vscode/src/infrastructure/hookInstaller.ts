import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { HookType, SettingsProvider } from "../settings/settingsProvider";
import { HOOK_RUNNER_REL, WORKSPACE_CONFIG_REL } from "../shared/workspacePaths";
import { removeHookRunnerScript, writeHookRunnerScript } from "./hookRunner";
import { getBundledReviewCliPath } from "./runtimePaths";
import { ensureWorkspaceReviewPrompt } from "./reviewPromptFile";
import {
  API_KEY_ENV_REL,
  getApiKey,
  hasHookUsableApiKey,
  syncHookEnvFile,
  WriteApiKeyResult,
} from "./secrets";

const HOOK_START = "# >>> ai-code-review";
const HOOK_END = "# <<< ai-code-review";
/** v1.0 扩展写入的 hook 标记，升级后需自动清理以免调用已失效的 CLI 路径 */
const LEGACY_HOOK_START = "# >>> cursor-pre-push-review";
const LEGACY_HOOK_END = "# <<< cursor-pre-push-review";

const HOOK_SCOPE: Record<HookType, "branch" | "uncommitted" | "staged"> = {
  "pre-push": "branch",
  "pre-commit": "staged",
  "commit-msg": "staged",
  "post-merge": "branch",
};

export class HookInstaller {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get repoRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  }

  private get huskyDir(): string {
    return path.join(this.repoRoot, ".husky");
  }

  private get gitHooksDir(): string {
    return path.join(this.repoRoot, ".git", "hooks");
  }

  private resolveHooksDir(): string {
    const configured = this.getGitHooksPath();
    if (configured) {
      return path.isAbsolute(configured)
        ? configured
        : path.join(this.repoRoot, configured);
    }
    return this.gitHooksDir;
  }

  private hookPath(hookType: HookType): string {
    return path.join(this.resolveHooksDir(), hookType);
  }

  private huskyHookPath(hookType: HookType): string {
    return path.join(this.huskyDir, hookType);
  }

  private getGitHooksPath(): string {
    if (!this.repoRoot) return "";
    try {
      return execFileSync("git", ["config", "--get", "core.hooksPath"], {
        cwd: this.repoRoot,
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  }

  private get cliPath(): string {
    return getBundledReviewCliPath(this.context.extensionPath);
  }

  private resolveNodeForHook(): { bin: string; useElectron: boolean } {
    try {
      const nodeBin = execFileSync("command", ["-v", "node"], {
        encoding: "utf8",
      }).trim();
      if (nodeBin) return { bin: nodeBin, useElectron: false };
    } catch {
      // fallback
    }
    return { bin: process.execPath, useElectron: true };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private removeBlockBetween(existing: string, start: string, end: string): string {
    const blockRe = new RegExp(
      `\\n?${this.escapeRegExp(start)}[\\s\\S]*?${this.escapeRegExp(end)}\\n?`,
      "m"
    );
    return existing.replace(blockRe, "\n");
  }

  private upsertManagedBlock(existing: string, managedBlock: string): string {
    const blockRe = new RegExp(
      `${this.escapeRegExp(HOOK_START)}[\\s\\S]*?${this.escapeRegExp(HOOK_END)}\\n?`,
      "m"
    );
    if (blockRe.test(existing)) {
      return existing.replace(blockRe, `${managedBlock}\n`);
    }
    const content = existing.trimEnd();
    return `${content}\n\n${managedBlock}\n`;
  }

  private removeManagedBlock(existing: string): string {
    let next = this.removeBlockBetween(existing, HOOK_START, HOOK_END);
    next = this.removeBlockBetween(next, LEGACY_HOOK_START, LEGACY_HOOK_END);
    return next.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }

  private normalizeHookContent(existing: string): string {
    return this.removeManagedBlock(existing);
  }

  private ensureHookFile(pathToHook: string): string {
    if (fs.existsSync(pathToHook)) {
      return fs.readFileSync(pathToHook, "utf8");
    }
    if (pathToHook.includes(`${path.sep}.husky${path.sep}`)) {
      return '#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\n\n';
    }
    return "#!/bin/sh\n";
  }

  private hasForeignHookContent(content: string): boolean {
    const stripped = this.normalizeHookContent(content);
    const meaningful = stripped
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !l.startsWith("#!") &&
          !l.startsWith("#") &&
          !l.includes("husky.sh")
      );
    return meaningful.length > 0;
  }

  private findInstalledHookPaths(): string[] {
    const hookTypes: HookType[] = [
      "pre-push",
      "pre-commit",
      "commit-msg",
      "post-merge",
    ];
    const candidates = new Set<string>();
    for (const t of hookTypes) {
      candidates.add(this.hookPath(t));
      candidates.add(this.huskyHookPath(t));
    }
    return [...candidates].filter((p) => {
      if (!fs.existsSync(p)) return false;
      const content = fs.readFileSync(p, "utf8");
      return content.includes(HOOK_START) || content.includes(LEGACY_HOOK_START);
    });
  }

  private hookTypeFromPath(hookPath: string): HookType | null {
    const base = path.basename(hookPath) as HookType;
    if (["pre-push", "pre-commit", "commit-msg", "post-merge"].includes(base)) {
      return base;
    }
    return null;
  }

  /** 旧版 shell 片段缺少 SKIP_REVIEW / config 检查，或 setup 未完成时仍 exit 1 阻断 push */
  private needsHookBlockUpgrade(content: string): boolean {
    if (!content.includes(HOOK_START)) return false;
    if (!content.includes("is_skip_review")) return true;
    if (!content.includes("CONFIG_FILE")) return true;
    if (/配置文件缺失[\s\S]*?exit 1/m.test(content)) return true;
    if (/hook runner 不可用[\s\S]*?exit 1/m.test(content)) return true;
    return false;
  }

  /** 将已安装的旧版 hook 片段刷新为最新模板（扩展升级后自动生效） */
  upgradeInstalledHookBlocks(): number {
    if (!this.repoRoot) return 0;
    let upgraded = 0;
    for (const hookFile of this.findInstalledHookPaths()) {
      try {
        const content = fs.readFileSync(hookFile, "utf8");
        if (!this.needsHookBlockUpgrade(content)) continue;
        const hookType = this.hookTypeFromPath(hookFile);
        if (!hookType) continue;
        const next = this.upsertManagedBlock(
          this.normalizeHookContent(content),
          this.buildHookContent(hookType)
        );
        fs.writeFileSync(hookFile, next, "utf8");
        fs.chmodSync(hookFile, "755");
        upgraded += 1;
      } catch {
        // ignore per-file errors
      }
    }
    return upgraded;
  }

  /** 扩展激活时清理 v1.0 遗留 hook 片段，避免 git push 调用已失效的 CLI 路径 */
  removeLegacyHookBlocks(): number {
    if (!this.repoRoot) return 0;
    const hookTypes: HookType[] = [
      "pre-push",
      "pre-commit",
      "commit-msg",
      "post-merge",
    ];
    let cleaned = 0;
    for (const hookType of hookTypes) {
      for (const hookFile of [this.hookPath(hookType), this.huskyHookPath(hookType)]) {
        if (!fs.existsSync(hookFile)) continue;
        try {
          const content = fs.readFileSync(hookFile, "utf8");
          if (!content.includes(LEGACY_HOOK_START)) continue;
          fs.writeFileSync(hookFile, this.normalizeHookContent(content), "utf8");
          cleaned += 1;
        } catch {
          // ignore per-file errors
        }
      }
    }
    return cleaned;
  }

  isHookInstalled(): boolean {
    return this.findInstalledHookPaths().length > 0;
  }

  getInstalledHookTypes(): HookType[] {
    const types = new Set<HookType>();
    for (const p of this.findInstalledHookPaths()) {
      const base = path.basename(p) as HookType;
      if (["pre-push", "pre-commit", "commit-msg", "post-merge"].includes(base)) {
        types.add(base);
      }
    }
    return [...types];
  }

  private validateCliPath(): boolean {
    if (fs.existsSync(this.cliPath)) return true;
    vscode.window.showErrorMessage(`未找到扩展内置 CLI: ${this.cliPath}`);
    return false;
  }

  private buildHookContent(hookType: HookType): string {
    const scope = HOOK_SCOPE[hookType];
    return [
      HOOK_START,
      'is_skip_review() {',
      '  case "$1" in 1|true|yes|TRUE|YES) return 0 ;; esac',
      "  return 1",
      "}",
      'if is_skip_review "$SKIP_REVIEW"; then exit 0; fi',
      'export PATH="$HOME/.local/bin:$PATH"',
      'REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
      `HOOK_RUNNER="$REPO_ROOT/${HOOK_RUNNER_REL}"`,
      `CONFIG_FILE="$REPO_ROOT/${WORKSPACE_CONFIG_REL}"`,
      'if [ ! -f "$CONFIG_FILE" ]; then',
      '  echo "[ai-code-review] 配置文件缺失，跳过审查（请在本机运行「启用 AI Code Review」）: $CONFIG_FILE" >&2',
      "  exit 0",
      "fi",
      'if [ -x "$HOOK_RUNNER" ]; then',
      `  "$HOOK_RUNNER" run --scope ${scope} || exit 1`,
      "else",
      '  echo "[ai-code-review] hook runner 不可用，跳过审查（请在本机运行「启用 AI Code Review」）: $HOOK_RUNNER" >&2',
      "  exit 0",
      "fi",
      HOOK_END,
    ].join("\n");
  }

  private syncHookRunnerScript(): boolean {
    const { bin, useElectron } = this.resolveNodeForHook();
    return writeHookRunnerScript(this.repoRoot, this.cliPath, bin, useElectron);
  }

  private isHuskyActiveHooksPath(hooksPath: string): boolean {
    const normalized = hooksPath.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized.endsWith(".husky/_");
  }

  private resolveHookTarget(hookType: HookType): string {
    const configured = this.getGitHooksPath();
    if (configured) {
      if (this.isHuskyActiveHooksPath(configured)) {
        return this.huskyHookPath(hookType);
      }
      return this.hookPath(hookType);
    }
    if (fs.existsSync(path.join(this.huskyDir, "_", "husky.sh"))) {
      return this.huskyHookPath(hookType);
    }
    return this.hookPath(hookType);
  }

  private removeHookType(hookType: HookType): void {
    for (const p of [this.hookPath(hookType), this.huskyHookPath(hookType)]) {
      if (!fs.existsSync(p)) continue;
      try {
        const next = this.normalizeHookContent(fs.readFileSync(p, "utf8"));
        fs.writeFileSync(p, next, "utf8");
      } catch {
        // ignore
      }
    }
  }

  private removeStaleHooks(configured: HookType[]): void {
    for (const t of this.getInstalledHookTypes()) {
      if (!configured.includes(t)) this.removeHookType(t);
    }
  }

  removeAllManagedHooks(): void {
    for (const hookType of [
      "pre-push",
      "pre-commit",
      "commit-msg",
      "post-merge",
    ] as HookType[]) {
      this.removeHookType(hookType);
    }
    removeHookRunnerScript(this.repoRoot);
  }

  private syncProviderHookEnv(
    settingsProvider: SettingsProvider,
    apiKey?: string
  ): WriteApiKeyResult {
    if (settingsProvider.reviewMode !== "provider") return "ok";
    return syncHookEnvFile(
      this.repoRoot,
      settingsProvider.providerHookEnvOptions(apiKey)
    );
  }

  private warnEnvSyncFailure(writeResult: WriteApiKeyResult): void {
    if (writeResult === "ok") return;
    vscode.window.showWarningMessage(
      `${API_KEY_ENV_REL} 无法写入（${writeResult}），Git hook 自动审查可能无法正常使用。`
    );
  }

  private async resolveProviderSecretKeyForEnv(): Promise<string | undefined> {
    if (hasHookUsableApiKey(this.repoRoot)) return undefined;
    const secretKey = await getApiKey(this.context);
    return secretKey || undefined;
  }

  /** 同步 hook env；warnOnFailure 时写入失败会提示用户 */
  private async syncProviderEnvFromContext(
    settingsProvider: SettingsProvider,
    options?: { warnOnFailure?: boolean }
  ): Promise<WriteApiKeyResult> {
    if (settingsProvider.reviewMode !== "provider" || !this.repoRoot) return "ok";
    const secretKey = await this.resolveProviderSecretKeyForEnv();
    const writeResult = this.syncProviderHookEnv(settingsProvider, secretKey);
    if (options?.warnOnFailure) this.warnEnvSyncFailure(writeResult);
    return writeResult;
  }

  /** Cursor 设置变更时同步 hook env（不修改 config.json / hook 片段） */
  async syncProviderEnvFromSettings(settingsProvider: SettingsProvider): Promise<void> {
    await this.syncProviderEnvFromContext(settingsProvider, { warnOnFailure: true });
  }

  /** Provider 模式：同步 env 并校验 hook 是否具备 API Key */
  private async ensureProviderHookEnv(
    settingsProvider: SettingsProvider
  ): Promise<boolean> {
    if (settingsProvider.reviewMode !== "provider") return true;

    const secretKey = !hasHookUsableApiKey(this.repoRoot)
      ? await getApiKey(this.context)
      : undefined;
    const writeResult = this.syncProviderHookEnv(settingsProvider, secretKey || undefined);

    if (writeResult !== "ok") {
      if (hasHookUsableApiKey(this.repoRoot)) {
        this.warnEnvSyncFailure(writeResult);
      } else if (secretKey) {
        this.removeAllManagedHooks();
        this.disableHooksInConfig(settingsProvider);
        vscode.window.showWarningMessage(
          `${API_KEY_ENV_REL} 无法安全写入（${writeResult}），已移除 Git hook 并关闭自动审查；手动审查仍可使用 SecretStorage 中的 API Key。`
        );
        return false;
      }
    }

    if (!hasHookUsableApiKey(this.repoRoot)) {
      this.removeAllManagedHooks();
      this.disableHooksInConfig(settingsProvider);
      vscode.window.showWarningMessage(
        `Provider 模式缺少 hook 可读取的 API Key（${API_KEY_ENV_REL}），已移除 Git hook 并关闭自动审查；请配置密钥后重新启用。`
      );
      return false;
    }

    return true;
  }

  /** hook 无法安装时移除片段并同步关闭 enabled，避免配置与磁盘不一致 */
  private disableHooksInConfig(settingsProvider: SettingsProvider): void {
    settingsProvider.writeWorkspaceConfigFile(settingsProvider.toConfig(false));
  }

  /** 配置文件中 hooks 变更时，同步磁盘上的 hook 片段（不弹确认框） */
  async syncFromConfig(settingsProvider: SettingsProvider): Promise<void> {
    if (!this.repoRoot) return;
    this.removeLegacyHookBlocks();
    if (!fs.existsSync(this.cliPath)) return;

    if (settingsProvider.hasConfigParseError) {
      this.removeAllManagedHooks();
      return;
    }

    if (!settingsProvider.getEffectiveConfig().enabled) {
      // 无工作区 config 时 enabled 默认为 false，不应删除仓库里已提交的 hook 片段
      if (settingsProvider.workspaceConfigExists && !settingsProvider.hasConfigParseError) {
        this.removeAllManagedHooks();
      }
      return;
    }

    const hooks = settingsProvider.hooks;
    this.removeStaleHooks(hooks);
    if (!hooks.length) {
      this.removeAllManagedHooks();
      return;
    }
    if (!(await this.ensureProviderHookEnv(settingsProvider))) {
      return;
    }

    if (!this.syncHookRunnerScript()) {
      vscode.window.showWarningMessage(
        "写入 .cursor/ai-code-review/hook.sh 失败，Git hook 可能无法执行审查。"
      );
      return;
    }

    const skippedForeign: HookType[] = [];

    for (const hookType of hooks) {
      const targetPath = this.resolveHookTarget(hookType);
      const existing = this.normalizeHookContent(this.ensureHookFile(targetPath));
      const alreadyHasBlock = existing.includes(HOOK_START);
      if (!alreadyHasBlock && this.hasForeignHookContent(existing)) {
        skippedForeign.push(hookType);
        vscode.window.showWarningMessage(
          `${hookType} 中已有其他逻辑，未自动追加审查片段；请使用「启用 AI Code Review」手动安装。`
        );
        continue;
      }
      const hookContent = this.buildHookContent(hookType);
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, this.upsertManagedBlock(existing, hookContent), {
          encoding: "utf8",
        });
        fs.chmodSync(targetPath, "755");
      } catch {
        // 静默失败，用户可重新「启用审查」
      }
    }

    if (skippedForeign.length > 0) {
      vscode.window.showWarningMessage(
        `未能向 ${skippedForeign.join(", ")} 追加审查片段（文件中已有其他逻辑）；请使用「启用 AI Code Review」手动安装，或调整 config.json 中的 hooks。`
      );
    }
  }

  private rollbackInstalledHooks(entries: Array<{ path: string; previous: string }>): void {
    for (const { path: hookPath, previous } of entries) {
      try {
        fs.writeFileSync(hookPath, previous, "utf8");
      } catch {
        // ignore rollback errors
      }
    }
  }

  async install(settingsProvider: SettingsProvider): Promise<boolean> {
    if (!this.repoRoot) {
      vscode.window.showErrorMessage("未找到工作区根目录");
      return false;
    }
    if (!this.validateCliPath()) return false;

    this.removeLegacyHookBlocks();

    const hooks = settingsProvider.hooks;
    if (!hooks.length) {
      this.removeStaleHooks([]);
      vscode.window.showInformationMessage(
        "未选择任何 hook（aiCodeReview.hooks 为空），仅写入工作区配置"
      );
      ensureWorkspaceReviewPrompt(this.context.extensionPath, this.repoRoot);
      const config = settingsProvider.toConfig(true);
      const ok = settingsProvider.writeWorkspaceConfigFile(config);
      if (ok) {
        await this.syncProviderEnvFromContext(settingsProvider, { warnOnFailure: true });
      }
      return ok;
    }

    this.removeStaleHooks(hooks);

    if (!this.syncHookRunnerScript()) {
      vscode.window.showErrorMessage("写入 .cursor/ai-code-review/hook.sh 失败");
      return false;
    }

    const installed: Array<{ path: string; previous: string }> = [];
    for (const hookType of hooks) {
      const targetPath = this.resolveHookTarget(hookType);
      const existing = this.normalizeHookContent(this.ensureHookFile(targetPath));

      if (this.hasForeignHookContent(existing)) {
        const choice = await vscode.window.showWarningMessage(
          `${hookType} 中已有其他逻辑，将在末尾追加审查片段。是否继续？`,
          "继续安装",
          "取消"
        );
        if (choice !== "继续安装") {
          this.rollbackInstalledHooks(installed);
          removeHookRunnerScript(this.repoRoot);
          return false;
        }
      }

      const hookContent = this.buildHookContent(hookType);
      try {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, this.upsertManagedBlock(existing, hookContent), {
          encoding: "utf8",
        });
        fs.chmodSync(targetPath, "755");
        installed.push({ path: targetPath, previous: existing });
      } catch (e) {
        this.rollbackInstalledHooks(installed);
        removeHookRunnerScript(this.repoRoot);
        vscode.window.showErrorMessage(`写入 ${hookType} hook 失败: ${e}`);
        return false;
      }
    }

    ensureWorkspaceReviewPrompt(this.context.extensionPath, this.repoRoot);
    const config = settingsProvider.toConfig(true);
    if (!settingsProvider.writeWorkspaceConfigFile(config)) {
      this.rollbackInstalledHooks(installed);
      removeHookRunnerScript(this.repoRoot);
      vscode.window.showErrorMessage("写入 .cursor/ai-code-review/config.json 失败");
      return false;
    }

    await this.syncProviderEnvFromContext(settingsProvider, { warnOnFailure: true });

    vscode.window.showInformationMessage(
      `已启用 AI Code Review\n- hooks: ${hooks.join(", ") || "无（仅手动审查）"}\n- 配置说明: .cursor/ai-code-review.说明.md`
    );
    return true;
  }

  async uninstall(settingsProvider: SettingsProvider): Promise<boolean> {
    this.removeLegacyHookBlocks();
    const paths = this.findInstalledHookPaths();
    if (paths.length === 0) {
      settingsProvider.writeWorkspaceConfigFile(settingsProvider.toConfig(false));
      return true;
    }

    const choice = await vscode.window.showWarningMessage(
      `将从 ${paths.length} 个 hook 文件中移除 AI Code Review 片段，是否继续？`,
      "移除",
      "取消"
    );
    if (choice !== "移除") return false;

    let anyFailed = false;
    for (const p of paths) {
      try {
        const next = this.normalizeHookContent(fs.readFileSync(p, "utf8"));
        fs.writeFileSync(p, next, "utf8");
      } catch (e) {
        anyFailed = true;
        vscode.window.showErrorMessage(`移除 ${p} 失败: ${e}`);
      }
    }

    if (anyFailed) return false;

    settingsProvider.writeWorkspaceConfigFile(settingsProvider.toConfig(false));
    vscode.window.showInformationMessage("已移除 AI Code Review hook 片段");
    return true;
  }
}
