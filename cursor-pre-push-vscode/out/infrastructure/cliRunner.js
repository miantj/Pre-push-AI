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
exports.runCliReview = runCliReview;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const runtimePaths_1 = require("./runtimePaths");
async function runCliReview(settingsProvider, extensionPath, options = {}) {
    const cliPath = (0, runtimePaths_1.getBundledReviewCliPath)(extensionPath);
    if (!fs.existsSync(cliPath)) {
        vscode.window.showErrorMessage(`未找到 CLI: ${cliPath}`);
        return false;
    }
    const cwd = settingsProvider.workspaceRoot;
    if (!cwd) {
        vscode.window.showErrorMessage("未打开工作区文件夹，无法执行审查");
        return false;
    }
    const enabled = options.forceEnabled ?? settingsProvider.enabled;
    const cmd = options.reviewOnly ? "review" : "run";
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)(process.execPath, [cliPath, cmd], {
            cwd,
            env: {
                ...(0, runtimePaths_1.augmentedPathEnv)(),
                ELECTRON_RUN_AS_NODE: "1",
                USE_AI_REVIEW_ON_PRE_PUSH_HOOK: enabled ? "true" : "false",
                CURSOR_PRE_PUSH_BASELINE: settingsProvider.baseline,
                AI_REVIEW_AGENT: settingsProvider.agent,
                CURSOR_PRE_PUSH_TIMEOUT_MS: String(settingsProvider.timeoutMs),
            },
        });
        let output = "";
        proc.stdout?.on("data", (data) => {
            output += data.toString();
        });
        proc.stderr?.on("data", (data) => {
            output += data.toString();
        });
        proc.on("close", (code) => {
            if (code !== 0) {
                const reportHint = settingsProvider.workspaceConfigPath
                    ? `.cursor/pre-push-find-bugs-last.md`
                    : "审查报告";
                vscode.window.showErrorMessage(`审查未通过（exit ${code}），请查看 ${reportHint}`);
                if (output.trim()) {
                    console.error(output);
                }
                resolve(false);
                return;
            }
            if (output.trim()) {
                const firstLine = output.trim().split("\n")[0];
                vscode.window.showInformationMessage(firstLine.substring(0, 120));
            }
            resolve(true);
        });
        proc.on("error", (err) => {
            vscode.window.showErrorMessage(`CLI 执行失败: ${err.message}`);
            resolve(false);
        });
    });
}
