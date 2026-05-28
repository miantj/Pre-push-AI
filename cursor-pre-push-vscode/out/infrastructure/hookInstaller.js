"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HookInstaller = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const HOOK_START = "# >>> cursor-pre-push-review";
const HOOK_END = "# <<< cursor-pre-push-review";
class HookInstaller {
    constructor(context) {
        this.context = context;
    }
    get repoRoot() {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    }
    get huskyHookPath() {
        return path.join(this.repoRoot, ".husky", "pre-push");
    }
    get gitHookPath() {
        return path.join(this.repoRoot, ".git", "hooks", "pre-push");
    }
    resolveHooksDir() {
        const configured = this.getGitHooksPath();
        if (configured) {
            return path.isAbsolute(configured)
                ? configured
                : path.join(this.repoRoot, configured);
        }
        return path.dirname(this.gitHookPath);
    }
    getActiveHookPath() {
        return path.join(this.resolveHooksDir(), "pre-push");
    }
    getGitHooksPath() {
        if (!this.repoRoot)
            return "";
        try {
            return (0, child_process_1.execFileSync)("git", ["config", "--get", "core.hooksPath"], {
                cwd: this.repoRoot,
                encoding: "utf8",
            }).trim();
        }
        catch {
            return "";
        }
    }
    get cliPath() {
        return path.join(this.context.extensionPath, "node_modules", "cursor-pre-push-review", "dist", "cli.js");
    }
    resolveNodeForHook() {
        try {
            const nodeBin = (0, child_process_1.execFileSync)("command", ["-v", "node"], {
                encoding: "utf8",
            }).trim();
            if (nodeBin)
                return { bin: nodeBin, useElectron: false };
        }
        catch {
            // fallback
        }
        return { bin: process.execPath, useElectron: true };
    }
    shellQuote(value) {
        return `'${String(value).replace(/'/g, `'\\''`)}'`;
    }
    upsertManagedBlock(existing, managedBlock) {
        const blockRe = new RegExp(`${HOOK_START}[\\s\\S]*?${HOOK_END}\\n?`, "m");
        if (blockRe.test(existing)) {
            return existing.replace(blockRe, `${managedBlock}\n`);
        }
        const content = existing.trimEnd();
        return `${content}\n\n${managedBlock}\n`;
    }
    removeManagedBlock(existing) {
        const blockRe = new RegExp(`\\n?${HOOK_START}[\\s\\S]*?${HOOK_END}\\n?`, "m");
        return existing.replace(blockRe, "\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
    }
    ensureHookFile(pathToHook) {
        if (fs.existsSync(pathToHook)) {
            return fs.readFileSync(pathToHook, "utf8");
        }
        if (pathToHook.includes(`${path.sep}.husky${path.sep}`)) {
            return '#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\n\n';
        }
        return "#!/bin/sh\n";
    }
    stripManagedBlock(content) {
        return this.removeManagedBlock(content);
    }
    hasForeignHookContent(content) {
        const stripped = this.stripManagedBlock(content);
        const meaningful = stripped
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l &&
            !l.startsWith("#!") &&
            !l.startsWith("#") &&
            !l.includes("husky.sh"));
        return meaningful.length > 0;
    }
    findInstalledHookPaths() {
        const candidates = new Set([
            this.getActiveHookPath(),
            this.huskyHookPath,
            this.gitHookPath,
        ]);
        return [...candidates].filter((p) => {
            if (!fs.existsSync(p))
                return false;
            return fs.readFileSync(p, "utf8").includes(HOOK_START);
        });
    }
    isHookInstalled() {
        return this.findInstalledHookPaths().length > 0;
    }
    validateCliPath() {
        if (fs.existsSync(this.cliPath))
            return true;
        vscode.window.showErrorMessage(`未找到扩展内置 CLI: ${this.cliPath}`);
        return false;
    }
    syncWorkspaceConfig(settingsProvider) {
        if (!this.repoRoot)
            return false;
        return settingsProvider.writeWorkspaceConfigFile(settingsProvider.toConfig());
    }
    async install(settingsProvider) {
        if (!this.repoRoot) {
            vscode.window.showErrorMessage("未找到工作区根目录");
            return false;
        }
        if (!this.validateCliPath()) {
            return false;
        }
        const config = settingsProvider.toConfig(true);
        if (!settingsProvider.writeWorkspaceConfigFile(config)) {
            vscode.window.showErrorMessage("写入 .cursor/pre-push-review.json 失败");
            return false;
        }
        const targetPath = this.getActiveHookPath();
        const existing = this.ensureHookFile(targetPath);
        if (this.hasForeignHookContent(existing)) {
            const choice = await vscode.window.showWarningMessage("pre-push 中已有其他逻辑，将在文件末尾追加审查片段（不会删除原有命令）。若与 scripts/pre-push.js 重复，请手动只保留一种方式。", "继续安装", "取消");
            if (choice !== "继续安装")
                return false;
        }
        else if (fs.existsSync(targetPath) &&
            !existing.includes(HOOK_START)) {
            const choice = await vscode.window.showWarningMessage("已存在 pre-push hook，将在末尾追加 Pre-push 审查片段，是否继续？", "继续", "取消");
            if (choice !== "继续")
                return false;
        }
        const hookContent = this.buildHookContent();
        try {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, this.upsertManagedBlock(existing, hookContent), {
                encoding: "utf8",
            });
            fs.chmodSync(targetPath, "755");
            vscode.window.showInformationMessage(`已启用 Pre-push 审查\n- hook: ${targetPath}\n- 配置: ${settingsProvider.workspaceConfigPath}`);
            return true;
        }
        catch (e) {
            vscode.window.showErrorMessage(`写入 hook 失败: ${e}`);
            return false;
        }
    }
    async uninstall(settingsProvider) {
        const paths = this.findInstalledHookPaths();
        if (paths.length === 0) {
            vscode.window.showInformationMessage("未找到已安装的审查片段");
            return true;
        }
        const choice = await vscode.window.showWarningMessage(`将从 ${paths.length} 个 pre-push 文件中移除 Pre-push 审查片段（保留其他 hook 逻辑），是否继续？`, "移除", "取消");
        if (choice !== "移除")
            return false;
        for (const p of paths) {
            try {
                const next = this.removeManagedBlock(fs.readFileSync(p, "utf8"));
                fs.writeFileSync(p, next, "utf8");
            }
            catch (e) {
                vscode.window.showErrorMessage(`移除 ${p} 中的审查片段失败: ${e}`);
            }
        }
        const cfg = settingsProvider.toConfig(false);
        settingsProvider.writeWorkspaceConfigFile(cfg);
        vscode.window.showInformationMessage("已移除 Pre-push 审查片段");
        return true;
    }
    buildHookContent() {
        const { bin, useElectron } = this.resolveNodeForHook();
        const electronPrefix = useElectron ? "ELECTRON_RUN_AS_NODE=1 \\\n" : "";
        return [
            HOOK_START,
            electronPrefix + `${this.shellQuote(bin)} ${this.shellQuote(this.cliPath)} run || exit 1`,
            HOOK_END,
        ].join("\n");
    }
}
exports.HookInstaller = HookInstaller;
