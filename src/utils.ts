import {
  commands,
  Disposable,
  ExtensionContext,
  ProgressLocation,
  RelativePattern,
  Uri,
  window,
  workspace,
} from "vscode";
import * as config from "./config";
import { EXTENSION_NAME, LEGACY_SWING_FILE, SWING_FILE } from "./constants";
import { openSwing } from "./preview";
import { store } from "./store";

export function byteArrayToString(value: Uint8Array) {
  return new TextDecoder().decode(value);
}

export function stringToByteArray(value: string) {
  return new TextEncoder().encode(value);
}

interface SwingWorkspaceCandidate {
  folderName: string;
  manifest: string;
  uri: Uri;
}

interface CheckForSwingWorkspaceOptions {
  initializeIfMissing?: boolean;
  promptForMultiple?: boolean;
  skipIfActive?: boolean;
}

async function pathExists(uri: Uri) {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function findSwingWorkspaceCandidates(): Promise<SwingWorkspaceCandidate[]> {
  const folders = workspace.workspaceFolders || [];
  const candidates: SwingWorkspaceCandidate[] = [];

  for (const folder of folders) {
    for (const manifest of [SWING_FILE, LEGACY_SWING_FILE]) {
      const manifestUri = Uri.joinPath(folder.uri, manifest);
      if (await pathExists(manifestUri)) {
        candidates.push({
          folderName: folder.name,
          manifest,
          uri: folder.uri,
        });
        break;
      }
    }
  }

  return candidates;
}

async function pickSwingWorkspaceCandidate(
  candidates: SwingWorkspaceCandidate[],
  promptForMultiple: boolean
) {
  if (candidates.length === 0) {
    return undefined;
  }

  if (candidates.length === 1 || !promptForMultiple) {
    return candidates[0];
  }

  const selected = await window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.folderName,
      description: candidate.manifest,
      detail: candidate.uri.fsPath,
      candidate,
    })),
    {
      placeHolder: "Select the DevSwing workspace to open",
      title: "Open DevSwing Workspace",
    }
  );

  return selected?.candidate;
}

export async function checkForSwingWorkspace(
  options: CheckForSwingWorkspaceOptions = {}
): Promise<boolean> {
  if (options.skipIfActive && store.activeSwing) {
    return false;
  }

  switch (config.get("launchBehavior")) {
    case "openSwing": {
      if (workspace.workspaceFolders) {
        const candidate = await pickSwingWorkspaceCandidate(
          await findSwingWorkspaceCandidates(),
          options.promptForMultiple ?? true
        );

        if (candidate) {
          await openSwing(candidate.uri);
          return true;
        }

        if ((options.initializeIfMissing ?? true) && config.get("rootDirectory")) {
          await commands.executeCommand(`${EXTENSION_NAME}.initializeWorkspace`);
          return true;
        }
      }
      break;
    }
    case "newSwing": {
      if (options.initializeIfMissing ?? true) {
        await commands.executeCommand(`${EXTENSION_NAME}.newSwing`);
        return true;
      }
      break;
    }
  }

  return false;
}

export function registerSwingWorkspaceWatcher(context: ExtensionContext) {
  let watchers: Disposable[] = [];
  let scheduledCheck: ReturnType<typeof setTimeout> | undefined;

  const disposeWatchers = () => {
    watchers.forEach((watcher) => watcher.dispose());
    watchers = [];
  };

  const scheduleCheck = () => {
    if (scheduledCheck) {
      clearTimeout(scheduledCheck);
    }

    scheduledCheck = setTimeout(() => {
      scheduledCheck = undefined;
      void checkForSwingWorkspace({
        initializeIfMissing: false,
        promptForMultiple: true,
        skipIfActive: true,
      });
    }, 250);
  };

  const registerWatchers = () => {
    disposeWatchers();

    for (const folder of workspace.workspaceFolders || []) {
      for (const manifest of [SWING_FILE, LEGACY_SWING_FILE]) {
        const watcher = workspace.createFileSystemWatcher(
          new RelativePattern(folder, manifest)
        );
        watcher.onDidCreate(scheduleCheck);
        watchers.push(watcher);
      }
    }
  };

  registerWatchers();

  context.subscriptions.push(
    workspace.onDidChangeWorkspaceFolders(registerWatchers),
    new Disposable(() => {
      if (scheduledCheck) {
        clearTimeout(scheduledCheck);
      }

      disposeWatchers();
    })
  );
}

export async function getFileContents(swingUri: Uri, file: string) {
  const uri = Uri.joinPath(swingUri, file);
  return getUriContents(uri);
}

export async function getUriContents(uri: Uri) {
  const contents = await workspace.fs.readFile(uri);
  return byteArrayToString(contents);
}

export function withProgress<T>(title: string, action: () => Promise<T>) {
  return window.withProgress(
    {
      location: ProgressLocation.Notification,
      title,
    },
    action
  );
}
