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
exports.SettingsProvider = exports.WORKSPACE_CONFIG_REL = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
exports.WORKSPACE_CONFIG_REL = ".cursor/pre-push-review.json";
class SettingsProvider {
    constructor() {
        this.configRoot = vscode.workspace.workspaceFolders?.[0];
    }
    get enabled() {
        return vscode.workspace.getConfiguration("cursorPrePush").get("enabled") ?? false;
    }
    get baseline() {
        return (vscode.workspace.getConfiguration("cursorPrePush").get("baseline") ?? "origin/stable");
    }
    get agent() {
        return vscode.workspace.getConfiguration("cursorPrePush").get("agent") ?? "cursor";
    }
    get rebaseEnabled() {
        return (vscode.workspace.getConfiguration("cursorPrePush").get("rebaseEnabled") ?? false);
    }
    get rebaseBranch() {
        return (vscode.workspace.getConfiguration("cursorPrePush").get("rebaseBranch") ??
            "origin/main");
    }
    get timeoutMs() {
        return (vscode.workspace.getConfiguration("cursorPrePush").get("timeoutMs") ?? 900000);
    }
    get workspaceRoot() {
        return this.configRoot?.uri.fsPath;
    }
    get workspaceConfigPath() {
        if (!this.configRoot)
            return null;
        return path.join(this.configRoot.uri.fsPath, exports.WORKSPACE_CONFIG_REL);
    }
    toConfig(enabledOverride) {
        return {
            enabled: enabledOverride ?? this.enabled,
            baseline: this.baseline,
            agent: (this.agent === "claude" ? "claude" : "cursor"),
            rebaseEnabled: this.rebaseEnabled,
            rebaseBranch: this.rebaseBranch,
            timeoutMs: this.timeoutMs,
        };
    }
    async setEnabled(value) {
        await vscode.workspace
            .getConfiguration("cursorPrePush")
            .update("enabled", value, vscode.ConfigurationTarget.Workspace);
    }
    writeWorkspaceConfigFile(config) {
        const root = this.workspaceRoot;
        if (!root)
            return false;
        const filePath = path.join(root, exports.WORKSPACE_CONFIG_REL);
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.SettingsProvider = SettingsProvider;
