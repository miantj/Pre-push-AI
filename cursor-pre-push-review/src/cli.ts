#!/usr/bin/env node
import * as path from "path";
import * as fs from "fs";
require("dotenv").config({
  path: path.join(process.cwd(), ".cursor", "ai-code-review", "env"),
});
import { runReview } from "./reviewer";
import { ReviewScope } from "./types";

function ignoreBrokenPipe(stream: NodeJS.WritableStream): void {
  stream.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code !== "EPIPE") {
      process.exit(1);
    }
  });
}

function isDeletePushFromStdin(): boolean {
  if (process.stdin.isTTY) return false;
  try {
    const stdin = fs.readFileSync(0, "utf8").trim();
    if (!stdin) return false;
    const lines = stdin.split("\n").filter((line) => line.trim());
    if (lines.length === 0) return false;
    // 仅当所有 ref 均为删除（localSha 全 0）时跳过；新建远程分支时 remoteSha 为全 0 属正常
    return lines.every((line) => {
      const parts = line.trim().split(/\s+/);
      const localSha = parts[1];
      return Boolean(localSha && /^0+$/.test(localSha));
    });
  } catch {
    return false;
  }
}

function parseArgs(argv: string[]): { cmd: string; scope?: ReviewScope } {
  const args = argv.slice(2);
  let cmd = "";
  let scope: ReviewScope | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--scope" && args[i + 1]) {
      const v = args[++i].toLowerCase();
      scope = v === "uncommitted" ? "uncommitted" : v === "staged" ? "staged" : "branch";
      continue;
    }
    if (!a.startsWith("-") && !cmd) {
      cmd = a;
    }
  }
  return { cmd, scope };
}

function printUsage(): void {
  console.log(`Usage:
  ai-code-review run [--scope branch|staged|uncommitted]     # git hook 触发
  ai-code-review review [--scope branch|staged|uncommitted]  # 手动审查
`);
}

async function main(): Promise<void> {
  const { cmd, scope } = parseArgs(process.argv);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }

  if (scope) {
    process.env.AI_CODE_REVIEW_SCOPE = scope;
  }

  if (cmd === "run") {
    process.env.AI_CODE_REVIEW_FROM_HOOK = "1";
  }

  if (isDeletePushFromStdin()) {
    console.log("[ai-code-review] 检测到 delete push，跳过审查");
    process.exit(0);
  }

  if (cmd !== "run" && cmd !== "review") {
    console.error(`[ai-code-review] 未知命令: ${cmd}`);
    printUsage();
    process.exit(1);
  }

  const result = await runReview(process.cwd());
  if (!result.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  ignoreBrokenPipe(process.stdout);
  ignoreBrokenPipe(process.stderr);
  main().catch((e) => {
    console.error("[ai-code-review] 执行失败:", e);
    process.exit(1);
  });
}
