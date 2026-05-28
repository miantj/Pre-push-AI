import * as vscode from "vscode";
import { ReportWebview } from "../views/reportWebview";

export function registerOpenReportCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("cursor.prePush.openReport", async () => {
      await ReportWebview.show(context);
    })
  );
}
