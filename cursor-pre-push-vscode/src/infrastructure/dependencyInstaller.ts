import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { augmentedPathEnv, isReviewCliPresent, resolveAgentBin } from "./runtimePaths";

const execFileAsync = promisify(execFile);
const SETUP_STATE_KEY = "dependencySetupVersion";

export interface DependencyStatus {
  reviewCli: boolean;
  agent: boolean;
}

export function getDependencyStatus(extensionPath: string): DependencyStatus {
  return {
    reviewCli: isReviewCliPresent(extensionPath),
    agent: Boolean(resolveAgentBin()),
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
    console.error("[cursor-pre-push-vscode] 安装 Cursor Agent CLI 失败:", e);
    return false;
  }

  return Boolean(resolveAgentBin());
}

function shouldAutoInstall(): boolean {
  return (
    vscode.workspace.getConfiguration("cursorPrePush").get<boolean>("autoInstallDependencies") ??
    true
  );
}

export async function ensureDependencies(
  context: vscode.ExtensionContext,
  options: { force?: boolean; silent?: boolean } = {}
): Promise<DependencyStatus> {
  if (!shouldAutoInstall() && !options.force) {
    return getDependencyStatus(context.extensionPath);
  }

  const version = context.extension.packageJSON.version as string;
  const status = getDependencyStatus(context.extensionPath);
  const alreadyDone =
    context.globalState.get<string>(SETUP_STATE_KEY) === version &&
    status.reviewCli &&
    status.agent;

  if (alreadyDone && !options.force) {
    return status;
  }

  const needsAgent = !status.agent;
  if (status.reviewCli && !needsAgent && !options.force) {
    await context.globalState.update(SETUP_STATE_KEY, version);
    return status;
  }

  const runInstall = async () => {
    const reviewOk = isReviewCliPresent(context.extensionPath);
    let agentOk = status.agent;

    if (needsAgent || options.force) {
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

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Pre-push AI Review：正在安装 Cursor Agent CLI…",
      cancellable: false,
    },
    async () => runInstall()
  );
}

export function notifyDependencyIssues(status: DependencyStatus): void {
  const missing: string[] = [];
  if (!status.reviewCli) {
    missing.push("扩展内置审查 CLI（请重新安装 VSIX 或联系维护者）");
  }
  if (!status.agent) missing.push("Cursor Agent CLI（agent）");
  if (missing.length === 0) return;

  const agentHint = "curl https://cursor.com/install -fsS | bash";
  const msg = !status.reviewCli
    ? `Pre-push 审查组件不完整：${missing.join("、")}。审查引擎已随 VSIX 打包，请重新执行 ./scripts/package-vscode.sh 生成并安装 VSIX。`
    : `Pre-push 审查依赖未就绪：${missing.join("、")}。可执行「安装 Pre-push 依赖」或手动：${agentHint}`;

  vscode.window
    .showWarningMessage(
      msg,
      "安装依赖",
      "查看文档"
    )
    .then((choice) => {
      if (choice === "安装依赖") {
        vscode.commands.executeCommand("cursor.prePush.installDeps");
      } else if (choice === "查看文档") {
        vscode.env.openExternal(vscode.Uri.parse("https://cursor.com/docs/cli/installation"));
      }
    });
}
