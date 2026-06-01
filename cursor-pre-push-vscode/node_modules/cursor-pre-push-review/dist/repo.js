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
exports.findGitRepoRoot = findGitRepoRoot;
exports.getCurrentBranch = getCurrentBranch;
exports.pathExists = pathExists;
exports.ensureDirForFile = ensureDirForFile;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function findGitRepoRoot(startDir = process.cwd()) {
    try {
        return (0, child_process_1.execFileSync)("git", ["rev-parse", "--show-toplevel"], {
            cwd: startDir,
            encoding: "utf8",
        }).trim();
    }
    catch {
        return startDir;
    }
}
function getCurrentBranch(repoRoot) {
    try {
        return (0, child_process_1.execFileSync)("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: repoRoot,
            encoding: "utf8",
        }).trim();
    }
    catch {
        return "";
    }
}
function pathExists(p) {
    try {
        fs.accessSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function ensureDirForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
