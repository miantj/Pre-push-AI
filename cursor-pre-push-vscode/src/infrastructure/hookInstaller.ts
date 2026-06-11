import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { HookType, SettingsProvider } from "../settings/settingsProvider";
import { removeHookRunnerScript, writeHookRunnerScript } from "./hookRunner";
import { getBundledReviewCliPath } from "./runtimePaths";
import { ensureWorkspaceReviewPrompt } from "./reviewPromptFile";
import {
  API_KEY_ENV_REL,
  getApiKey,
  hasHookUsableApiKey,
  writeDotEnvApiKey,
} from "./secrets";

const HOOK_START = "# >>> ai-code-review";
const HOOK_END = "# <<< ai-code-review";

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

  private upsertManagedBlock(existing: string, managedBlock: string): string {
    const blockRe = new RegExp(`${HOOK_START}[\\s\\S]*?${HOOK_END}\\n?`, "m");
    if (blockRe.test(existing)) {
      return existing.replace(blockRe, `${managedBlock}\n`);
    }
    const content = existing.trimEnd();
    return `${content}\n\n${managedBlock}\n`;
  }

  private removeManagedBlock(existing: string): string {
    const blockRe = new RegExp(`\\n?${HOOK_START}[\\s\\S]*?${HOOK_END}\\n?`, "m");
    return existing.replace(blockRe, "\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
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
      return content.includes(HOOK_START);
    });
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
      'export PATH="$HOME/.local/bin:$PATH"',
      'REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
      'HOOK_RUNNER="$REPO_ROOT/.cursor/ai-code-review-hook.sh"',
      'if [ -x "$HOOK_RUNNER" ]; then',
      `  "$HOOK_RUNNER" run --scope ${scope} || exit 1`,
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

  /** 配置文件中 hooks 变更时，同步磁盘上的 hook 片段（不弹确认框） */
  async syncFromConfig(settingsProvider: SettingsProvider): Promise<void> {
    if (!this.repoRoot || !fs.existsSync(this.cliPath)) return;

    if (settingsProvider.hasConfigParseError) {
      this.removeAllManagedHooks();
      return;
    }

    if (!settingsProvider.getEffectiveConfig().enabled) {
      this.removeAllManagedHooks();
      return;
    }

    const hooks = settingsProvider.hooks;
    this.removeStaleHooks(hooks);
    if (!hooks.length) {
      this.removeAllManagedHooks();
      return;
    }
    if (
      settingsProvider.reviewMode === "provider" &&
      !hasHookUsableApiKey(this.repoRoot)
    ) {
      const secretKey = await getApiKey(this.context);
      if (secretKey) {
        const writeResult = writeDotEnvApiKey(this.repoRoot, secretKey);
        if (writeResult === "ok" || hasHookUsableApiKey(this.repoRoot)) {
          // SecretStorage 中已有密钥，已同步到 hook 可读取的 env 文件。
        } else {
          this.removeAllManagedHooks();
          vscode.window.showWarningMessage(
            `${API_KEY_ENV_REL} 无法安全写入（${writeResult}），已移除 Git hook；手动审查仍可使用 SecretStorage 中的 API Key。`
          );
          return;
        }
      }
    }

    if (
      settingsProvider.reviewMode === "provider" &&
      !hasHookUsableApiKey(this.repoRoot)
    ) {
      this.removeAllManagedHooks();
      vscode.window.showWarningMessage(
        `Provider 模式缺少 hook 可读取的 API Key（${API_KEY_ENV_REL}），已移除 Git hook；请配置密钥后重新启用 hook。`
      );
      return;
    }

    if (!this.syncHookRunnerScript()) return;

    for (const hookType of hooks) {
      const targetPath = this.resolveHookTarget(hookType);
      const existing = this.ensureHookFile(targetPath);
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

    const hooks = settingsProvider.hooks;
    if (!hooks.length) {
      this.removeStaleHooks([]);
      vscode.window.showInformationMessage(
        "未选择任何 hook（aiCodeReview.hooks 为空），仅写入工作区配置"
      );
      ensureWorkspaceReviewPrompt(this.context.extensionPath, this.repoRoot);
      const config = settingsProvider.toConfig(true);
      return settingsProvider.writeWorkspaceConfigFile(config);
    }

    this.removeStaleHooks(hooks);

    if (!this.syncHookRunnerScript()) {
      vscode.window.showErrorMessage("写入 .cursor/ai-code-review-hook.sh 失败");
      return false;
    }

    const installed: Array<{ path: string; previous: string }> = [];
    for (const hookType of hooks) {
      const targetPath = this.resolveHookTarget(hookType);
      const existing = this.ensureHookFile(targetPath);

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
      vscode.window.showErrorMessage("写入 .cursor/ai-code-review.json 失败");
      return false;
    }

    vscode.window.showInformationMessage(
      `已启用 AI Code Review\n- hooks: ${hooks.join(", ") || "无（仅手动审查）"}\n- 配置说明: .cursor/ai-code-review.说明.md`
    );
    return true;
  }

  async uninstall(settingsProvider: SettingsProvider): Promise<boolean> {
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
