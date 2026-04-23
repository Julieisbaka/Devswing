import * as vscode from "vscode";
import { generateSwingWithCopilot, isCopilotAvailable } from "../ai";
import * as config from "../config";
import { EXTENSION_NAME, SWING_FILE, SWING_FILES } from "../constants";
import { DEFAULT_MANIFEST, openSwing } from "../preview";
import { SwingFile, store } from "../store";
import { stringToByteArray, withProgress } from "../utils";
import {
  enableGalleries,
  loadGalleries,
  registerTemplateProvider,
} from "./galleryProvider";
import { initializeStorage, storage } from "./storage";

interface DevSwingTemplateItem extends vscode.QuickPickItem {
  files?: SwingFile[];
}

async function createSwingDirectory() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = now.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} (${pad(h12)}-${pad(now.getMinutes())}-${pad(now.getSeconds())} ${ampm})`;

  const rootDirectory = config.get("rootDirectory");
  const rootUri = rootDirectory
    ? vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        rootDirectory
      )
    : store.globalStorageUri!;

  const swingDirectory = vscode.Uri.joinPath(rootUri, timestamp);

  await vscode.workspace.fs.createDirectory(swingDirectory);
  return swingDirectory;
}

async function getTemplates(): Promise<DevSwingTemplateItem[]> {
  const galleries = await loadGalleries();

  const templates: DevSwingTemplateItem[] = galleries
    .filter((gallery) => gallery.enabled)
    .flatMap((gallery) => gallery.templates)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t) => ({ ...t, label: t.title }));

  return templates;
}

export async function newSwing(
  uri: vscode.Uri | ((files: SwingFile[]) => Promise<vscode.Uri>),
  title: string = "Create new swing"
) {
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = title;
  quickPick.placeholder = "Select the template to use";
  quickPick.matchOnDescription = true;
  quickPick.ignoreFocusOut = true;

  const templates = await getTemplates();
  if (templates.length === 0) {
    templates.push({
      label:
        "No templates available. Configure your template galleries and try again.",
    });
  }

  const mru = storage.getTemplateMRU();
  if (mru && mru.length > 0) {
    for (let i = mru.length - 1; i >= 0; i--) {
      const itemIndex = templates.findIndex(
        (gallery) => gallery.label === mru[i]
      );
      if (itemIndex !== -1) {
        const [item] = templates.splice(itemIndex, 1);
        item.alwaysShow = true;
        item.description = "Recently used";
        templates.unshift(item);
      }
    }
  }

  const copilotTooltip = "Generate swing with Copilot";
  const copilotAvailable = await isCopilotAvailable();
  const quickPickButtons: vscode.QuickInputButton[] = [
    {
      iconPath: new vscode.ThemeIcon("settings"),
      tooltip: "Configure Template Galleries",
    },
  ];

  if (copilotAvailable) {
    quickPickButtons.unshift({
      iconPath: new vscode.ThemeIcon("sparkle"),
      tooltip: copilotTooltip,
    });
  }

  quickPick.items = templates;
  quickPick.buttons = quickPickButtons;

  quickPick.onDidTriggerButton((e) => {
    if (e.tooltip === copilotTooltip) {
      synthesizeTemplate(uri);
    } else {
      promptForGalleryConfiguration(uri, title);
    }
  });

  quickPick.onDidAccept(async () => {
    quickPick.hide();

    const template = quickPick.selectedItems[0] as DevSwingTemplateItem;
    if (template.files) {
      await withProgress("Creating swing...", async () =>
        newSwingFromTemplate(template.files!, uri)
      );

      await storage.addTemplateToMRU(template.label);
    }
  });

  quickPick.show();
}

async function synthesizeTemplate(
  uri: vscode.Uri | ((files: SwingFile[]) => Promise<vscode.Uri>)
) {
  const prompt = await vscode.window.showInputBox({
    placeHolder: "Describe the swing you want to generate",
  });
  if (!prompt) { return; }

  await withProgress("Creating swing with Copilot...", async () => {
    const files = await generateSwingWithCopilot(prompt);
    return newSwingFromTemplate(files!, uri);
  });
}

async function newSwingFromTemplate(
  files: SwingFile[],
  uri: vscode.Uri | ((files: SwingFile[]) => Promise<vscode.Uri>)
) {
  const manifest = files.find((file) => SWING_FILES.includes(file.filename));
  if (!manifest) {
    const content = JSON.stringify(DEFAULT_MANIFEST, null, 2);
    files.push({ filename: SWING_FILE, content });
  } else if (manifest.content) {
    if (manifest.filename !== SWING_FILE) {
      manifest.filename = SWING_FILE;
    }

    try {
      const content = JSON.parse(manifest.content);
      delete content.template;
      manifest.content = JSON.stringify(content, null, 2);
    } catch {
      // If the template included an invalid
      // manifest file, then there's nothing
      // we can really do about it.
    }
  }

  let swingUri: vscode.Uri;
  if (uri instanceof Function) {
    swingUri = await uri(
      files.map(({ filename, content }) => ({
        filename,
        content: content ? content : "",
      }))
    );
  } else {
    await Promise.all(
      files.map(({ filename, content = "" }) => {
        const targetFileUri = vscode.Uri.joinPath(uri, filename);
        return vscode.workspace.fs.writeFile(
          targetFileUri,
          stringToByteArray(content)
        );
      })
    );
    swingUri = uri;
  }

  openSwing(swingUri);
}

async function promptForGalleryConfiguration(
  uri: vscode.Uri | ((files: SwingFile[]) => Promise<vscode.Uri>),
  title: string
) {
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = "Configure template galleries";
  quickPick.placeholder =
    "Select the galleries you'd like to display templates from";
  quickPick.canSelectMany = true;

  const galleries = (await loadGalleries())
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((gallery) => ({ ...gallery, label: gallery.title }));

  quickPick.items = galleries;
  quickPick.selectedItems = galleries.filter((gallery) => gallery.enabled);

  quickPick.buttons = [vscode.QuickInputButtons.Back];
  quickPick.onDidTriggerButton((e) => {
    if (e === vscode.QuickInputButtons.Back) {
      return newSwing(uri, title);
    }
  });

  quickPick.onDidAccept(async () => {
    const galleries = quickPick.selectedItems.map((item) => (item as any).id);

    quickPick.busy = true;
    await enableGalleries(galleries);
    quickPick.busy = false;

    quickPick.hide();

    return newSwing(uri, title);
  });

  quickPick.show();
}

export function registerCreationModule(
  context: vscode.ExtensionContext,
  api: any,
  syncKeys: string[]
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(`${EXTENSION_NAME}.newSwing`, async () => {
      const uri = await createSwingDirectory();
      newSwing(uri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.newSwingFromLastTemplate`,
      async () => {
        const [latestTemplate] = storage.getTemplateMRU();
        const templates = await getTemplates();
        const template = templates.find(
          (template) => template.label === latestTemplate
        );
        if (template) {
          const uri = await createSwingDirectory();
          newSwingFromTemplate(template.files!, uri);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.newSwingDirectory`,
      async () => {
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri: vscode.workspace.workspaceFolders?.[0].uri,
        });

        if (folder) {
          newSwing(folder[0]);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.initializeWorkspace`,
      async () => {
        const uri = vscode.workspace.workspaceFolders![0].uri;
        newSwing(uri);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      `${EXTENSION_NAME}.saveCurrentSwing`,
      async () => {
        const folder = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri: vscode.workspace.workspaceFolders?.[0].uri,
        });

        if (!folder) {
          return;
        }

        await withProgress("Saving swing...", async () => {
          const files = await vscode.workspace.fs.readDirectory(
            store.activeSwing!.rootUri
          );
          return Promise.all(
            files.map(async ([file]) => {
              const sourceUri = vscode.Uri.joinPath(
                store.activeSwing!.rootUri,
                file
              );
              const contents = await vscode.workspace.fs.readFile(sourceUri);

              const uri = vscode.Uri.joinPath(folder[0], file);
              await vscode.workspace.fs.writeFile(uri, contents);
            })
          );
        });
      }
    )
  );

  initializeStorage(context, syncKeys);

  api.newSwing = newSwing;
  api.registerTemplateProvider = registerTemplateProvider;
}
