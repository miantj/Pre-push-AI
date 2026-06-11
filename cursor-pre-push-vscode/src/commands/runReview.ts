import * as vscode from "vscode";
import { ReviewScope, SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { runCliReview } from "../infrastructure/cliRunner";
import { validateBeforeEnable } from "../infrastructure/enableGuard";
import {
  ensureDependencies,
  notifyDependencyIssues,
} from "../infrastructure/dependencyInstaller";

async function pickReviewScope(defaultScope: ReviewScope): Promise<ReviewScope | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "$(git-branch) 相对目标分支",
        description: "merge-base(HEAD, baseline)..HEAD",
        scope: "branch" as ReviewScope,
      },
      {
        label: "$(diff) 未提交变更",
        description: "git diff HEAD（暂存 + 未暂存 + 新文件）",
        scope: "uncommitted" as ReviewScope,
      },
      {
        label: "$(checklist) 暂存区变更",
        description: "git diff --cached（即将 commit 的内容）",
        scope: "staged" as ReviewScope,
      },
    ],
    {
      title: "选择审查范围",
      placeHolder:
        defaultScope === "branch"
          ? "相对目标分支"
          : defaultScope === "staged"
            ? "暂存区变更"
            : "未提交变更",
    }
  );
  if (!picked) return undefined;
  return picked.scope;
}

async function runReviewFlow(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): Promise<void> {
  if (settingsProvider.reviewMode === "agent") {
    const agentType = settingsProvider.agent;
    const deps = await ensureDependencies(context, { agentType });
    if (!deps.reviewCli || !deps.agent) {
      notifyDependencyIssues(deps, { agentType });
      return;
    }
  } else {
    const deps = await ensureDependencies(context, { skipAgent: true });
    if (!deps.reviewCli) {
      notifyDependencyIssues(deps);
      return;
    }
  }

  const scope = await pickReviewScope(settingsProvider.defaultScope);
  if (!scope) return;

  let forceEnabled = settingsProvider.enabled;
  if (!forceEnabled) {
    const choice = await vscode.window.showWarningMessage(
      "AI Code Review 未启用，是否继续本次审查？",
      "启用并审查",
      "仅本次审查",
      "取消"
    );
    if (choice === "取消" || !choice) return;
    if (choice === "启用并审查") {
      if (!(await validateBeforeEnable(context, settingsProvider))) return;
      const ok = await hookInstaller.install(settingsProvider);
      if (!ok) return;
      forceEnabled = true;
    } else {
      forceEnabled = true;
    }
  }

  const scopeLabel =
    scope === "branch" ? "目标分支增量" : scope === "staged" ? "暂存区变更" : "未提交变更";
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `AI Code Review：正在审查（${scopeLabel}）…`,
      cancellable: false,
    },
    async () => {
      const result = await runCliReview(settingsProvider, context.extensionPath, context, {
        reviewOnly: true,
        forceEnabled,
        scope,
      });
      if (result) {
        vscode.commands.executeCommand("aiCodeReview.openReport");
      } else {
        const open = await vscode.window.showWarningMessage(
          "审查完成但未通过或出错，是否查看报告？",
          "查看报告"
        );
        if (open === "查看报告") {
          vscode.commands.executeCommand("aiCodeReview.openReport");
        }
      }
    }
  );
}

export function registerRunReviewCommand(
  context: vscode.ExtensionContext,
  settingsProvider: SettingsProvider,
  hookInstaller: HookInstaller
): void {
  const handler = () => runReviewFlow(context, settingsProvider, hookInstaller);
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeReview.runReview", handler)
  );
}
