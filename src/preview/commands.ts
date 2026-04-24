import * as vscode from "vscode";
import { openSwing } from ".";
import { generateSwingWithCopilot, refineSwingWithCopilot } from "../ai";
import * as config from "../config";
import { EXTENSION_NAME } from "../constants";
import { storage as creationStorage, RecentSwing } from "../creation/storage";
import { store, SwingFile, SwingLibraryType } from "../store";
import { byteArrayToString, checkForSwingWorkspace, withProgress } from "../utils";
import { SwingLayout } from "./layoutManager";
import { addScriptModule, addSwingLibrary } from "./libraries";

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function pathExists(path: string) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return true;
  } catch {
    return false;
  }
}

function formatLastOpened(lastOpened: number) {
  return new Date(lastOpened).toLocaleString();
}

type RecentSwingPick = {
  label: string;
  description?: string;
  detail?: string;
  entry?: RecentSwing;
  action?: "clearMissing";
};

async function browseRecentSwings() {
  const mru = creationStorage.getRecentTempSwings();
  if (mru.length === 0) {
    vscode.window.showInformationMessage("No recent temporary swings yet.");
    return;
  }

  void creationStorage.cleanupMissingRecentTempSwings();

  const recentSwingItems: RecentSwingPick[] = [
    {
      label: "$(clear-all) Clear Missing Swings",
      description: "Remove deleted temporary swings from this list",
      action: "clearMissing",
    },
    ...mru.map((entry) => ({
      label: vscode.workspace.asRelativePath(entry.path, false),
      description: formatLastOpened(entry.lastOpened),
      detail: entry.path,
      entry,
    })),
  ];

  const selected = await vscode.window.showQuickPick(
    recentSwingItems,
    {
      placeHolder: "Select a recent swing",
      title: "Browse Recent Swings",
    }
  );

  if (!selected) {
    return;
  }

  if (selected.action === "clearMissing") {
    const removed = await creationStorage.cleanupMissingRecentTempSwings();
    vscode.window.showInformationMessage(
      removed === 0
        ? "No missing temporary swings were found."
        : `Removed ${removed} missing temporary swing${removed === 1 ? "" : "s"}.`
    );
    return;
  }

  if (!selected.entry) {
    return;
  }

  const selectedEntry = selected.entry;

  if (!(await pathExists(selectedEntry.path))) {
    await creationStorage.removeRecentTempSwing(selectedEntry.path);
    vscode.window.showWarningMessage(
      "That temporary swing no longer exists, so it was removed from the recent list."
    );
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: "Open", action: "open" as const },
      { label: "Reveal in File Explorer", action: "reveal" as const },
      { label: "Delete", action: "delete" as const },
    ],
    {
      placeHolder: `Action for ${selectedEntry.path}`,
    }
  );

  if (!action) {
    return;
  }

  const swingUri = vscode.Uri.file(selectedEntry.path);
  switch (action.action) {
    case "open":
      await openSwing(swingUri);
      break;
    case "reveal":
      await vscode.commands.executeCommand("revealFileInOS", swingUri);
      break;
    case "delete": {
      const confirmation = await vscode.window.showWarningMessage(
        `Delete swing folder '${selectedEntry.path}'?`,
        { modal: true },
        "Delete"
      );
      if (confirmation !== "Delete") {
        return;
      }

      await vscode.workspace.fs.delete(swingUri, { recursive: true, useTrash: true });
      await creationStorage.removeRecentTempSwing(selectedEntry.path);

      const activeSwing = store.activeSwing;
      if (activeSwing?.rootUri.fsPath === selectedEntry.path) {
        activeSwing.webViewPanel.dispose();
      }

      vscode.window.showInformationMessage("Temporary swing deleted.");
      break;
    }
  }
}

export async function registerSwingCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.browseRecentSwings`,
      browseRecentSwings
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.addLibrary`,
      async () => {
        const items = [
          {
            label: "Script",
            description: "Adds a <script> reference, before your swing script",
            libraryType: SwingLibraryType.script,
          },
          {
            label: "Stylesheet",
            description:
              "Adds a <link rel='stylesheet' /> reference, before your swing styles",
            libraryType: SwingLibraryType.style,
          },
        ];

        if (store.activeSwing?.scriptEditor) {
          items.unshift({
            label: "Script module",
            description:
              "Adds a import statement to the top of your swing script",
            // @ts-ignore
            libraryType: "module",
          });
        }

        const response = await vscode.window.showQuickPick(items, {
          placeHolder: "Select the library type you'd like to add",
        });

        if (response) {
          if (
            response.libraryType === SwingLibraryType.script ||
            response.libraryType === SwingLibraryType.style
          ) {
            addSwingLibrary(response.libraryType);
          } else {
            addScriptModule();
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_NAME}.openConsole`, () =>
      store.activeSwing?.console.show()
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.openDeveloperTools`,
      () => {
        vscode.commands.executeCommand(
          "workbench.action.webview.openDeveloperTools"
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_NAME}.run`, async () => {
      store.activeSwing?.webView.rebuildWebview();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.refineWithCopilot`,
      async () => {
        const prompt = await vscode.window.showInputBox({
          placeHolder: "Describe the change you'd like to make",
        });
        if (!prompt) { return; }

        const swingUri = store.activeSwing!.rootUri;
        const fileEntries = await vscode.workspace.fs.readDirectory(swingUri);
        const currentFiles: SwingFile[] = await Promise.all(
          fileEntries
            .filter(([, type]) => type === vscode.FileType.File)
            .map(async ([name]) => {
              const uri = vscode.Uri.joinPath(swingUri, name);
              const bytes = await vscode.workspace.fs.readFile(uri);
              return { filename: name, content: byteArrayToString(bytes) };
            })
        );

        await withProgress("Refining swing with Copilot...", async () => {
          const files = await refineSwingWithCopilot(prompt, currentFiles);
          for (const file of files) {
            await vscode.workspace.fs.writeFile(
              vscode.Uri.joinPath(swingUri, file.filename),
              Buffer.from(file.content || "")
            );
          }
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.generateWithCopilot`,
      async () => {
        const prompt = await vscode.window.showInputBox({
          placeHolder: "Describe the swing you want to generate",
        });
        if (!prompt) { return; }

        const swingUri = store.activeSwing?.rootUri;
        if (!swingUri) { return; }

        await withProgress("Generating swing with Copilot...", async () => {
          const files = await generateSwingWithCopilot(prompt);
          for (const file of files) {
            await vscode.workspace.fs.writeFile(
              vscode.Uri.joinPath(swingUri, file.filename),
              Buffer.from(file.content || "")
            );
          }
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.changeLayout`,
      async () => {
        const items = Object.keys(SwingLayout).map((layout) => {
          return { label: capitalizeFirst(layout), layout };
        });
        const result = await vscode.window.showQuickPick(items, {
          placeHolder: "Select the layout to use for swings",
        });

        if (result) {
          await config.set("layout", result.layout);
          openSwing(store.activeSwing!.rootUri);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_NAME}.openSwing`, async () => {
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
      });

      if (folder) {
        openSwing(folder[0]);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.openSwingInNewWindow`,
      async () => {
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
        });

        if (folder) {
          vscode.commands.executeCommand("vscode.openFolder", folder[0], {
            forceNewWindow: true,
          });
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.openWorkspaceSwing`,
      () => {
        checkForSwingWorkspace({ initializeIfMissing: false });
      }
    )
  );
}
