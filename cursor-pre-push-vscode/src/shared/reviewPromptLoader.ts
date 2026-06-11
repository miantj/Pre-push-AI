import * as path from "path";
import { ReviewScope } from "../settings/settingsProvider";

interface PromptModule {
  buildDefaultEditableReviewPrompt: () => string;
  buildDefaultReviewInstructions: (scope: ReviewScope, baseline: string) => string;
}

function loadPromptModule(extensionPath: string): PromptModule {
  const modPath = path.join(extensionPath, "node_modules/ai-code-review/dist/prompt.js");
  return require(modPath) as PromptModule;
}

export function loadDefaultReviewInstructions(
  extensionPath: string,
  scope: ReviewScope,
  baseline: string
): string {
  return loadPromptModule(extensionPath).buildDefaultReviewInstructions(scope, baseline);
}

export function loadDefaultEditableReviewPrompt(extensionPath: string): string {
  return loadPromptModule(extensionPath).buildDefaultEditableReviewPrompt();
}
