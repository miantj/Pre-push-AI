import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export const WORKSPACE_CONFIG_REL = ".cursor/pre-push-review.json";

export interface PrePushReviewConfig {
  enabled: boolean;
  baseline: string;
  agent: "cursor" | "claude";
  timeoutMs: number;
}

export class SettingsProvider {
  private configRoot: vscode.WorkspaceFolder | undefined;

  constructor() {
    this.configRoot = vscode.workspace.workspaceFolders?.[0];
  }

  get enabled(): boolean {
    return vscode.workspace.getConfiguration("cursorPrePush").get<boolean>("enabled") ?? false;
  }

  get baseline(): string {
    return (
      vscode.workspace.getConfiguration("cursorPrePush").get<string>("baseline") ?? "auto"
    );
  }

  get agent(): string {
    return vscode.workspace.getConfiguration("cursorPrePush").get<string>("agent") ?? "cursor";
  }

  get timeoutMs(): number {
    return (
      vscode.workspace.getConfiguration("cursorPrePush").get<number>("timeoutMs") ?? 900000
    );
  }

  get workspaceRoot(): string | undefined {
    return this.configRoot?.uri.fsPath;
  }

  get workspaceConfigPath(): string | null {
    if (!this.configRoot) return null;
    return path.join(this.configRoot.uri.fsPath, WORKSPACE_CONFIG_REL);
  }

  toConfig(enabledOverride?: boolean): PrePushReviewConfig {
    return {
      enabled: enabledOverride ?? this.enabled,
      baseline: this.baseline,
      agent: (this.agent === "claude" ? "claude" : "cursor") as "cursor" | "claude",
      timeoutMs: this.timeoutMs,
    };
  }

  async setEnabled(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration("cursorPrePush")
      .update("enabled", value, vscode.ConfigurationTarget.Workspace);
  }

  writeWorkspaceConfigFile(config: PrePushReviewConfig): boolean {
    const root = this.workspaceRoot;
    if (!root) return false;
    const filePath = path.join(root, WORKSPACE_CONFIG_REL);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      return true;
    } catch {
      return false;
    }
  }
}
