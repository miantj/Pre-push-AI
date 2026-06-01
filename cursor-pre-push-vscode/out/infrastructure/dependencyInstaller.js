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
exports.getDependencyStatus = getDependencyStatus;
exports.ensureDependencies = ensureDependencies;
exports.notifyDependencyIssues = notifyDependencyIssues;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const runtimePaths_1 = require("./runtimePaths");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const SETUP_STATE_KEY = "dependencySetupVersion";
function getDependencyStatus(extensionPath) {
    return {
        reviewCli: (0, runtimePaths_1.isReviewCliPresent)(extensionPath),
        agent: Boolean((0, runtimePaths_1.resolveAgentBin)()),
    };
}
async function installCursorAgent() {
    if ((0, runtimePaths_1.resolveAgentBin)())
        return true;
    try {
        if (process.platform === "win32") {
            await execFileAsync("powershell", [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "irm 'https://cursor.com/install?win32=true' | iex",
            ], { timeout: 300000, env: (0, runtimePaths_1.augmentedPathEnv)() });
        }
        else {
            await execFileAsync("bash", ["-c", "curl https://cursor.com/install -fsS | bash"], { timeout: 300000, env: (0, runtimePaths_1.augmentedPathEnv)() });
        }
    }
    catch (e) {
        console.error("[cursor-pre-push-vscode] 安装 Cursor Agent CLI 失败:", e);
        return false;
    }
    return Boolean((0, runtimePaths_1.resolveAgentBin)());
}
function shouldAutoInstall() {
    return (vscode.workspace.getConfiguration("cursorPrePush").get("autoInstallDependencies") ??
        true);
}
async function ensureDependencies(context, options = {}) {
    if (!shouldAutoInstall() && !options.force) {
        return getDependencyStatus(context.extensionPath);
    }
    const version = context.extension.packageJSON.version;
    const status = getDependencyStatus(context.extensionPath);
    const alreadyDone = context.globalState.get(SETUP_STATE_KEY) === version &&
        status.reviewCli &&
        status.agent;
    if (alreadyDone && !options.force) {
        return status;
    }
    const needsAgent = !status.agent;
    if (status.reviewCli && !needsAgent && !options.force) {
        await context.globalState.update(SETUP_STATE_KEY, version);
        return status;
    }
    const runInstall = async () => {
        const reviewOk = (0, runtimePaths_1.isReviewCliPresent)(context.extensionPath);
        let agentOk = status.agent;
        if (needsAgent || options.force) {
            agentOk = await installCursorAgent();
        }
        if (reviewOk && agentOk) {
            await context.globalState.update(SETUP_STATE_KEY, version);
        }
        return { reviewCli: reviewOk, agent: agentOk };
    };
    if (options.silent) {
        return runInstall();
    }
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Pre-push AI Review：正在安装 Cursor Agent CLI…",
        cancellable: false,
    }, async () => runInstall());
}
function notifyDependencyIssues(status) {
    const missing = [];
    if (!status.reviewCli) {
        missing.push("扩展内置审查 CLI（请重新安装 VSIX 或联系维护者）");
    }
    if (!status.agent)
        missing.push("Cursor Agent CLI（agent）");
    if (missing.length === 0)
        return;
    const agentHint = "curl https://cursor.com/install -fsS | bash";
    const msg = !status.reviewCli
        ? `Pre-push 审查组件不完整：${missing.join("、")}。审查引擎已随 VSIX 打包，请重新执行 ./scripts/package-vscode.sh 生成并安装 VSIX。`
        : `Pre-push 审查依赖未就绪：${missing.join("、")}。可执行「安装 Pre-push 依赖」或手动：${agentHint}`;
    vscode.window
        .showWarningMessage(msg, "安装依赖", "查看文档")
        .then((choice) => {
        if (choice === "安装依赖") {
            vscode.commands.executeCommand("cursor.prePush.installDeps");
        }
        else if (choice === "查看文档") {
            vscode.env.openExternal(vscode.Uri.parse("https://cursor.com/docs/cli/installation"));
        }
    });
}
