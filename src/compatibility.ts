import * as vscode from "vscode";
import { EXTENSION_NAME, LEGACY_COMMAND_PREFIX } from "./constants";

const LEGACY_COMMANDS = [
  "addLibrary",
  "browseRecentSwings",
  "addSwingFile",
  "changeLayout",
  "deleteSwingFile",
  "exportToCodePen",
  "exportToStackBlitz",
  "generateWithCopilot",
  "initializeWorkspace",
  "newSwing",
  "newSwingDirectory",
  "newSwingFromLastTemplate",
  "newSwingInNewWindow",
  "openConsole",
  "openDeveloperTools",
  "openSwing",
  "openSwingInNewWindow",
  "openWorkspaceSwing",
  "recordCodeTour",
  "refineWithCopilot",
  "renameSwingFile",
  "run",
  "saveCurrentSwing",
  "uploadSwingFile",
] as const;

export function registerLegacyCommandAliases(
  context: vscode.ExtensionContext
) {
  for (const command of LEGACY_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `${LEGACY_COMMAND_PREFIX}.${command}`,
        (...args: unknown[]) =>
          vscode.commands.executeCommand(
            `${EXTENSION_NAME}.${command}`,
            ...args
          )
      )
    );
  }
}
