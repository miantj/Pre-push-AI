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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const enable_1 = require("./commands/enable");
const disable_1 = require("./commands/disable");
const runReview_1 = require("./commands/runReview");
const openReport_1 = require("./commands/openReport");
const installDeps_1 = require("./commands/installDeps");
const settingsProvider_1 = require("./settings/settingsProvider");
const hookInstaller_1 = require("./infrastructure/hookInstaller");
const statusBar_1 = require("./infrastructure/statusBar");
const dependencyInstaller_1 = require("./infrastructure/dependencyInstaller");
function activate(context) {
    const settingsProvider = new settingsProvider_1.SettingsProvider();
    const hookInstaller = new hookInstaller_1.HookInstaller(context);
    (0, enable_1.registerEnableCommand)(context, settingsProvider, hookInstaller);
    (0, disable_1.registerDisableCommand)(context, settingsProvider, hookInstaller);
    (0, runReview_1.registerRunReviewCommand)(context, settingsProvider, hookInstaller);
    (0, openReport_1.registerOpenReportCommand)(context);
    (0, installDeps_1.registerInstallDepsCommand)(context);
    void (0, dependencyInstaller_1.ensureDependencies)(context, { silent: true }).then((status) => {
        if (!status.reviewCli) {
            (0, dependencyInstaller_1.notifyDependencyIssues)(status);
            return;
        }
        if (!status.agent) {
            (0, dependencyInstaller_1.notifyDependencyIssues)(status);
        }
    });
    (0, statusBar_1.updateStatusBar)(settingsProvider, hookInstaller);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("cursorPrePush"))
            return;
        if (hookInstaller.isHookInstalled()) {
            hookInstaller.syncWorkspaceConfig(settingsProvider);
        }
        (0, statusBar_1.updateStatusBar)(settingsProvider, hookInstaller);
    }));
}
function deactivate() { }
