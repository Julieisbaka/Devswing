import * as vscode from "vscode";
import { api } from "./api";
import { registerLegacyCommandAliases } from "./compatibility";
import { registerCreationModule } from "./creation";
import { registerLiveShareModule } from "./liveShare";
import { registerPreviewModule } from "./preview";
import { registerTreeViewModule } from "./preview/tree";
import { store } from "./store";
import { checkForSwingWorkspace, registerSwingWorkspaceWatcher } from "./utils";

export async function activate(context: vscode.ExtensionContext) {
  store.globalStorageUri = context.globalStorageUri;

  const syncKeys: string[] = [];

  registerCreationModule(context, api, syncKeys);
  registerPreviewModule(context, api, syncKeys);

  context.globalState.setKeysForSync(syncKeys);

  registerLegacyCommandAliases(context);
  registerTreeViewModule(context);
  registerLiveShareModule(context.extension.id);
  registerSwingWorkspaceWatcher(context);

  await checkForSwingWorkspace();

  return api;
}
