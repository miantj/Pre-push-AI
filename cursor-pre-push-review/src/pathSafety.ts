import * as fs from "fs";
import * as path from "path";

export function isPathInsideRepo(repoRoot: string, absPath: string): boolean {
  const rootResolved = path.resolve(repoRoot);
  let real: string;
  try {
    real = fs.realpathSync(absPath);
  } catch {
    return false;
  }
  return real === rootResolved || real.startsWith(`${rootResolved}${path.sep}`);
}

/** 未跟踪文件：拒绝 symlink，且 realpath 须在仓库内 */
export function isSafeUntrackedPath(repoRoot: string, relPath: string): boolean {
  const abs = path.resolve(repoRoot, relPath);
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) return false;
    if (!st.isFile()) return false;
  } catch {
    return false;
  }
  return isPathInsideRepo(repoRoot, abs);
}
