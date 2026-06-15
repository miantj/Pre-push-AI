import * as vscode from "vscode";
import { ReportWebview } from "../views/reportWebview";

export function registerOpenReportCommand(context: vscode.ExtensionContext): void {
  const handler = () => ReportWebview.show(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodeReview.openReport", handler)
  );
}
