import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { ResolvedRuntimeConfig } from "./config";
import { getTotalDiffCharCount, safeExecGit } from "./git";
import { ReviewResult, ReviewScope } from "./types";

export const PASS_CACHE_REL = ".cursor/ai-code-review-pass-cache";

function passCacheFilePath(repoRoot: string): string {
  return path.join(repoRoot, PASS_CACHE_REL);
}

export function readPassCacheKey(repoRoot: string): string | undefined {
  const filePath = passCacheFilePath(repoRoot);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const key = fs.readFileSync(filePath, "utf8").trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export function writePassCacheKey(repoRoot: string, key: string | null): void {
  const filePath = passCacheFilePath(repoRoot);
  try {
    if (!key) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${key}\n`, "utf8");
  } catch {
    // ignore
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function unstableCacheBuster(reason: string): string {
  return `unavailable:${reason}:${Date.now()}:${process.hrtime.bigint().toString()}`;
}

function isTrackedInIndex(repoRoot: string, filePath: string): boolean {
  return safeExecGit(repoRoot, ["ls-files", "--error-unmatch", "--", filePath], "") !== "";
}

function hashSafeWorktreeFile(repoRoot: string, filePath: string): string {
  const repoResolved = path.resolve(repoRoot);
  const absPath = path.resolve(repoRoot, filePath);
  try {
    const stat = fs.lstatSync(absPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return `unsafe:${filePath}`;
    }
    const realPath = fs.realpathSync(absPath);
    if (realPath !== repoResolved && !realPath.startsWith(`${repoResolved}${path.sep}`)) {
      return `outside:${filePath}`;
    }
    return `sha256:${createHash("sha256").update(fs.readFileSync(absPath)).digest("hex")}`;
  } catch {
    return `missing:${filePath}`;
  }
}

function diffArgsForScope(
  scope: ReviewScope,
  mergeBase: string | undefined,
  filePath: string
): string[] {
  if (scope === "staged") {
    return ["diff", "--cached", "--binary", "--", filePath];
  }
  if (scope === "uncommitted") {
    return ["diff", "HEAD", "--binary", "--", filePath];
  }
  return ["diff", "--binary", `${mergeBase ?? "HEAD"}..HEAD`, "--", filePath];
}

function computeDiffFingerprint(
  repoRoot: string,
  scope: ReviewScope,
  mergeBase: string | undefined,
  changedFiles: string[]
): string {
  const parts = [...changedFiles].sort().map((filePath) => {
    if (scope === "uncommitted" && !isTrackedInIndex(repoRoot, filePath)) {
      return ["untracked", filePath, hashSafeWorktreeFile(repoRoot, filePath)].join("\0");
    }

    const fallback = unstableCacheBuster(filePath);
    const diffText = safeExecGit(repoRoot, diffArgsForScope(scope, mergeBase, filePath), fallback);
    return ["diff", filePath, hashText(diffText)].join("\0");
  });

  return hashText(parts.join("\0"));
}

export function computePassCacheKey(
  repoRoot: string,
  scope: ReviewScope,
  baseline: string,
  mergeBase: string | undefined,
  changedFiles: string[],
  config: ResolvedRuntimeConfig,
  totalDiffChars?: number
): string {
  const head = safeExecGit(repoRoot, ["rev-parse", "HEAD"], "(unknown)");
  const files = [...changedFiles].sort().join("\n");
  const configSig = [
    config.reviewMode,
    config.agent,
    config.provider.type,
    config.provider.model,
    config.baseline,
  ].join("|");
  const promptPath = path.join(repoRoot, ".cursor/ai-code-review-prompt.md");
  let promptMtime = "0";
  try {
    promptMtime = String(fs.statSync(promptPath).mtimeMs);
  } catch {
    // ignore
  }
  const diffSize = String(
    totalDiffChars ?? getTotalDiffCharCount(repoRoot, scope, mergeBase, changedFiles)
  );
  const diffFingerprint = computeDiffFingerprint(repoRoot, scope, mergeBase, changedFiles);
  const payload = [
    scope,
    baseline,
    head,
    configSig,
    promptMtime,
    files,
    diffSize,
    diffFingerprint,
  ].join("\0");
  return createHash("sha256").update(payload).digest("hex");
}

export function syncPassCache(
  repoRoot: string,
  cacheKey: string,
  result: ReviewResult
): ReviewResult {
  if (result.cacheable) {
    writePassCacheKey(repoRoot, cacheKey);
  } else if (!result.skipped) {
    writePassCacheKey(repoRoot, null);
  }
  return result;
}
