#!/usr/bin/env node
import * as path from "path";
import * as fs from "fs";
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
import { runReview } from "./reviewer";

function isDeletePushFromStdin(): boolean {
  if (process.stdin.isTTY) return false;
  try {
    const stdin = fs.readFileSync(0, "utf8").trim();
    if (!stdin) return false;
    return stdin.split("\n").some((line) => {
      const parts = line.trim().split(/\s+/);
      const localSha = parts[1];
      const remoteSha = parts[3];
      return (
        Boolean(localSha && /^0+$/.test(localSha)) ||
        Boolean(remoteSha && /^0+$/.test(remoteSha))
      );
    });
  } catch {
    return false;
  }
}

function printUsage(): void {
  console.log(`Usage:
  cursor-pre-push run      # pre-push hook：按 .cursor/pre-push-review.json 执行审查
  cursor-pre-push review   # 手动审查当前分支（不经过 push）
`);
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }

  if (isDeletePushFromStdin()) {
    console.log("[cursor-pre-push] 检测到 delete push，跳过审查");
    process.exit(0);
  }

  if (cmd !== "run" && cmd !== "review") {
    console.error(`[cursor-pre-push] 未知命令: ${cmd}`);
    printUsage();
    process.exit(1);
  }

  const result = runReview(process.cwd());
  if (!result.ok) {
    process.exit(1);
  }
}
