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
exports.registerRunReviewCommand = registerRunReviewCommand;
const vscode = __importStar(require("vscode"));
const cliRunner_1 = require("../infrastructure/cliRunner");
const dependencyInstaller_1 = require("../infrastructure/dependencyInstaller");
function registerRunReviewCommand(context, settingsProvider, hookInstaller) {
    context.subscriptions.push(vscode.commands.registerCommand("cursor.prePush.runReview", async () => {
        const deps = await (0, dependencyInstaller_1.ensureDependencies)(context);
        if (!deps.reviewCli || !deps.agent) {
            (0, dependencyInstaller_1.notifyDependencyIssues)(deps);
            return;
        }
        let forceEnabled = settingsProvider.enabled;
        if (!forceEnabled) {
            const choice = await vscode.window.showWarningMessage("Pre-push 审查未启用，是否立即启用？", "启用并审查", "仅本次审查", "取消");
            if (choice === "取消" || !choice)
                return;
            if (choice === "启用并审查") {
                const ok = await hookInstaller.install(settingsProvider);
                if (!ok)
                    return;
                await settingsProvider.setEnabled(true);
                forceEnabled = true;
            }
            else {
                forceEnabled = true;
            }
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在执行 Pre-push 审查...",
            cancellable: false,
        }, async () => {
            const result = await (0, cliRunner_1.runCliReview)(settingsProvider, context.extensionPath, {
                reviewOnly: true,
                forceEnabled,
            });
            if (result) {
                vscode.commands.executeCommand("cursor.prePush.openReport");
            }
        });
    }));
}
