import * as vscode from "vscode";
import { ReviewScope, SettingsProvider } from "../settings/settingsProvider";
import { HookInstaller } from "../infrastructure/hookInstaller";
import { runCliReview } from "../infrastructure/cliRunner";
import {
  endReviewProgress,
  setReviewProgress,
} from "../infrastructure/statusBar";
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
    const deps = await ensureDependencies(context, { agentType, silent: true });
    if (!deps.reviewCli || !deps.agent) {
      notifyDependencyIssues(deps, { agentType });
      return;
    }
  } else {
    const deps = await ensureDependencies(context, { skipAgent: true, silent: true });
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
  const backendLabel =
    settingsProvider.reviewMode === "provider"
      ? settingsProvider.providerType
      : settingsProvider.agent;

  try {
    setReviewProgress(`准备审查（${scopeLabel} · ${backendLabel}）…`);

    const result = await runCliReview(settingsProvider, context.extensionPath, context, {
      reviewOnly: true,
      forceEnabled,
      scope,
      onProgress: (message) => setReviewProgress(message),
    });

    if (result) {
      setReviewProgress("审查通过（PASS）");
      vscode.commands.executeCommand("aiCodeReview.openReport");
    } else {
      setReviewProgress("审查完成（FAIL 或异常）");
      const open = await vscode.window.showWarningMessage(
        "审查完成但未通过或出错，是否查看报告？",
        "查看报告"
      );
      if (open === "查看报告") {
        vscode.commands.executeCommand("aiCodeReview.openReport");
      }
    }
  } finally {
    endReviewProgress(settingsProvider, hookInstaller);
  }
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
