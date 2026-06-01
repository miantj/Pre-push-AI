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
exports.getBundledReviewCliPath = getBundledReviewCliPath;
exports.isReviewCliPresent = isReviewCliPresent;
exports.resolveAgentBin = resolveAgentBin;
exports.augmentedPathEnv = augmentedPathEnv;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const REVIEW_PKG = "cursor-pre-push-review";
function getBundledReviewCliPath(extensionPath) {
    return path.join(extensionPath, "node_modules", REVIEW_PKG, "dist", "cli.js");
}
function isReviewCliPresent(extensionPath) {
    return fs.existsSync(getBundledReviewCliPath(extensionPath));
}
/** 与 reviewer 一致：优先 CURSOR_AGENT_BIN，再 ~/.local/bin/agent，再 PATH 中的 agent */
function resolveAgentBin() {
    const fromEnv = process.env.CURSOR_AGENT_BIN?.trim();
    if (fromEnv && fs.existsSync(fromEnv))
        return fromEnv;
    const localAgent = path.join(os.homedir(), ".local", "bin", "agent");
    if (fs.existsSync(localAgent))
        return localAgent;
    try {
        return (0, child_process_1.execFileSync)("bash", ["-lc", "command -v agent"], { encoding: "utf8" }).trim();
    }
    catch {
        return "";
    }
}
function augmentedPathEnv() {
    const localBin = path.join(os.homedir(), ".local", "bin");
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const current = process.env[pathKey] ?? "";
    if (current.split(path.delimiter).includes(localBin)) {
        return { ...process.env };
    }
    return { ...process.env, [pathKey]: `${localBin}${path.delimiter}${current}` };
}
