"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execGit = execGit;
exports.safeExecGit = safeExecGit;
exports.getMergeBase = getMergeBase;
exports.buildGitContext = buildGitContext;
exports.parsePositiveInt = parsePositiveInt;
const child_process_1 = require("child_process");
function execGit(repoRoot, args) {
    return (0, child_process_1.execFileSync)("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
    }).trim();
}
function safeExecGit(repoRoot, args, fallback) {
    try {
        return execGit(repoRoot, args);
    }
    catch {
        return fallback;
    }
}
function getMergeBase(repoRoot, baseline = "origin/stable") {
    try {
        return execGit(repoRoot, ["merge-base", "HEAD", baseline]);
    }
    catch {
        return null;
    }
}
function buildGitContext(repoRoot, baseline = "origin/stable") {
    const mergeBase = getMergeBase(repoRoot, baseline);
    if (!mergeBase) {
        return {
            ok: false,
            text: "(Could not compute merge-base; skip diff context.)",
        };
    }
    const logText = safeExecGit(repoRoot, ["log", "--oneline", `${mergeBase}..HEAD`], "(empty)");
    const statText = safeExecGit(repoRoot, ["diff", "--stat", `${mergeBase}..HEAD`], "(empty)");
    const diffText = safeExecGit(repoRoot, ["diff", `${mergeBase}..HEAD`], "(empty)");
    const maxDiff = parseInt(process.env.CURSOR_PRE_PUSH_MAX_DIFF_CHARS || "120000", 10);
    const truncatedDiff = diffText.length > maxDiff
        ? diffText.slice(0, maxDiff) + `\n\n[... truncated, original ${diffText.length} chars]`
        : diffText;
    const isEmpty = (!logText || logText === "(empty)") &&
        (!statText || statText === "(empty)") &&
        (!diffText || diffText === "(empty)");
    return {
        ok: true,
        mergeBase,
        isEmpty,
        text: [
            "### Review baseline (vs stable)",
            `Range **merge-base(HEAD, ${baseline})..HEAD** = commits and file changes on the current branch relative to **${baseline}**.`,
            "",
            "### merge-base",
            mergeBase,
            "",
            "### git log --oneline merge-base..HEAD",
            logText || "(empty)",
            "",
            "### git diff --stat merge-base..HEAD",
            statText || "(empty)",
            "",
            "### git diff merge-base..HEAD",
            truncatedDiff,
        ].join("\n"),
    };
}
function parsePositiveInt(raw, fallback) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
