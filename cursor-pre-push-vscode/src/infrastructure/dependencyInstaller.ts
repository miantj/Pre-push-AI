import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  AgentCliType,
  augmentedPathEnv,
  isReviewCliPresent,
  resolveAgentBin,
  resolveAgentCliBin,
} from "./runtimePaths";

const execFileAsync = promisify(execFile);
const SETUP_STATE_KEY = "dependencySetupVersion";

export interface DependencyStatus {
  reviewCli: boolean;
  agent: boolean;
}

export interface DependencyOptions {
  force?: boolean;
  silent?: boolean;
  /** Provider 模式：跳过 Agent CLI 检查与安装 */
  skipAgent?: boolean;
  /** Agent 模式下的目标 CLI：cursor → agent，claude → claude */
  agentType?: AgentCliType;
}

export function getDependencyStatus(
  extensionPath: string,
  options: Pick<DependencyOptions, "skipAgent" | "agentType"> = {}
): DependencyStatus {
  const skipAgent = options.skipAgent ?? false;
  const agentType = options.agentType ?? "cursor";
  return {
    reviewCli: isReviewCliPresent(extensionPath),
    agent: skipAgent ? true : Boolean(resolveAgentCliBin(agentType)),
  };
}

async function installCursorAgent(): Promise<boolean> {
  if (resolveAgentBin()) return true;

  try {
    if (process.platform === "win32") {
      await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "irm 'https://cursor.com/install?win32=true' | iex",
        ],
        { timeout: 300_000, env: augmentedPathEnv() }
      );
    } else {
      await execFileAsync(
        "bash",
        ["-c", "curl https://cursor.com/install -fsS | bash"],
        { timeout: 300_000, env: augmentedPathEnv() }
      );
    }
  } catch (e) {
    console.error("[ai-code-review] 安装 Cursor Agent CLI 失败:", e);
    return false;
  }

  return Boolean(resolveAgentBin());
}

function shouldAutoInstall(): boolean {
  const primary = vscode.workspace
    .getConfiguration("aiCodeReview")
    .get<boolean>("autoInstallDependencies");
  return primary ?? true;
}

export async function ensureDependencies(
  context: vscode.ExtensionContext,
  options: DependencyOptions = {}
): Promise<DependencyStatus> {
  const agentType = options.agentType ?? "cursor";
  const skipAgent = options.skipAgent ?? false;

  if (!shouldAutoInstall() && !options.force) {
    return getDependencyStatus(context.extensionPath, { skipAgent, agentType });
  }

  const version = context.extension.packageJSON.version as string;
  const status = getDependencyStatus(context.extensionPath, { skipAgent, agentType });
  const alreadyDone =
    context.globalState.get<string>(SETUP_STATE_KEY) === version &&
    status.reviewCli &&
    status.agent;

  if (alreadyDone && !options.force) {
    return status;
  }

  const needsCursorAgentInstall =
    !skipAgent && agentType === "cursor" && !status.agent;
  if (status.reviewCli && !needsCursorAgentInstall && !options.force) {
    await context.globalState.update(SETUP_STATE_KEY, version);
    return status;
  }

  const runInstall = async () => {
    const reviewOk = isReviewCliPresent(context.extensionPath);
    let agentOk = skipAgent ? true : status.agent;

    if (needsCursorAgentInstall || (options.force && !skipAgent && agentType === "cursor")) {
      agentOk = await installCursorAgent();
    }

    if (reviewOk && agentOk) {
      await context.globalState.update(SETUP_STATE_KEY, version);
    }

    return { reviewCli: reviewOk, agent: agentOk };
  };

  if (options.silent) {
    return runInstall();
  }

  const progressTitle =
    agentType === "claude"
      ? "AI Code Review：正在检查 Claude Code CLI…"
      : "AI Code Review：正在安装 Cursor Agent CLI…";

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
      cancellable: false,
    },
    async () => runInstall()
  );
}

export function notifyDependencyIssues(
  status: DependencyStatus,
  options: Pick<DependencyOptions, "agentType"> = {}
): void {
  const agentType = options.agentType ?? "cursor";
  const missing: string[] = [];
  if (!status.reviewCli) {
    missing.push("扩展内置审查 CLI（请重新安装 VSIX 或联系维护者）");
  }
  if (!status.agent) {
    missing.push(
      agentType === "claude" ? "Claude Code CLI（claude）" : "Cursor Agent CLI（agent）"
    );
  }
  if (missing.length === 0) return;

  const agentHint =
    agentType === "claude"
      ? "请安装 Claude Code CLI（https://docs.anthropic.com/en/docs/claude-code/overview）"
      : "curl https://cursor.com/install -fsS | bash";
  const msg = !status.reviewCli
    ? `AI Code Review 组件不完整：${missing.join("、")}。审查引擎已随 VSIX 打包，请重新执行 ./scripts/package-vscode.sh 生成并安装 VSIX。`
    : `AI Code Review 依赖未就绪：${missing.join("、")}。可执行「安装 Agent CLI 依赖」、切换 Provider 模式，或手动：${agentHint}`;

  vscode.window
    .showWarningMessage(msg, "安装依赖", "查看文档")
    .then((choice) => {
      if (choice === "安装依赖") {
        vscode.commands.executeCommand("aiCodeReview.installDeps");
      } else if (choice === "查看文档") {
        const url =
          agentType === "claude"
            ? "https://docs.anthropic.com/en/docs/claude-code/overview"
            : "https://cursor.com/docs/cli/installation";
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    });
}
