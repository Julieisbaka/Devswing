import { commands, ExtensionContext, Uri, workspace } from "vscode";
import { EXTENSION_NAME } from "../constants";
import { store } from "../store";

const TEMPLATE_MRU_SIZE = 3;
const SWING_MRU_SIZE = 20;

const TEMPLATE_MRU_CONTEXT_KEY = `${EXTENSION_NAME}:hasTemplateMRU`;
const TEMPLATE_MRU_STORAGE_KEY = `${EXTENSION_NAME}:templateMRU`;

const RECENT_SWINGS_CONTEXT_KEY = `${EXTENSION_NAME}:hasRecentTempSwings`;
const RECENT_SWINGS_STORAGE_KEY = `${EXTENSION_NAME}:recentTempSwings`;

export interface RecentSwing {
  path: string;
  lastOpened: number;
}

export interface IStorage {
  getTemplateMRU(): string[];
  addTemplateToMRU(template: string): Promise<void>;
  getRecentTempSwings(): RecentSwing[];
  addRecentTempSwing(uri: Uri): Promise<void>;
  removeRecentTempSwing(path: string): Promise<void>;
  cleanupMissingRecentTempSwings(): Promise<number>;
}

async function pathExists(path: string) {
  try {
    await workspace.fs.stat(Uri.file(path));
    return true;
  } catch {
    return false;
  }
}

export let storage: IStorage;
export async function initializeStorage(
  context: ExtensionContext,
  syncKeys: string[]
) {
  storage = {
    getTemplateMRU(): string[] {
      const mru = context.globalState.get<string[]>(TEMPLATE_MRU_STORAGE_KEY) || [];
      return mru.filter((template) => template !== null);
    },
    async addTemplateToMRU(template: string) {
      const mru = this.getTemplateMRU();
      if (mru.includes(template)) {
        const oldIndex = mru.findIndex((item) => item === template);
        mru.splice(oldIndex, 1);
      }

      mru.unshift(template);

      while (mru.length > TEMPLATE_MRU_SIZE) {
        mru.pop();
      }

      await context.globalState.update(TEMPLATE_MRU_STORAGE_KEY, mru);
      await commands.executeCommand("setContext", TEMPLATE_MRU_CONTEXT_KEY, true);
    },
    getRecentTempSwings(): RecentSwing[] {
      const swings =
        context.globalState.get<RecentSwing[]>(RECENT_SWINGS_STORAGE_KEY) || [];

      return swings
        .filter((entry) => !!entry?.path)
        .sort((a, b) => b.lastOpened - a.lastOpened);
    },
    async addRecentTempSwing(uri: Uri) {
      const tempRoot = store.globalStorageUri;
      if (!tempRoot) {
        return;
      }

      const normalizedRoot = tempRoot.path.toLocaleLowerCase();
      const normalizedPath = uri.path.toLocaleLowerCase();
      if (!normalizedPath.startsWith(normalizedRoot)) {
        return;
      }

      const swings = this.getRecentTempSwings();
      const nextSwings = swings.filter((entry) => entry.path !== uri.fsPath);
      nextSwings.unshift({
        path: uri.fsPath,
        lastOpened: Date.now(),
      });

      while (nextSwings.length > SWING_MRU_SIZE) {
        nextSwings.pop();
      }

      await context.globalState.update(RECENT_SWINGS_STORAGE_KEY, nextSwings);
      await commands.executeCommand(
        "setContext",
        RECENT_SWINGS_CONTEXT_KEY,
        nextSwings.length > 0
      );
    },
    async removeRecentTempSwing(path: string) {
      const swings = this.getRecentTempSwings();
      const nextSwings = swings.filter((entry) => entry.path !== path);
      await context.globalState.update(RECENT_SWINGS_STORAGE_KEY, nextSwings);
      await commands.executeCommand(
        "setContext",
        RECENT_SWINGS_CONTEXT_KEY,
        nextSwings.length > 0
      );
    },
    async cleanupMissingRecentTempSwings() {
      const swings = this.getRecentTempSwings();
      const existing: RecentSwing[] = [];

      for (const swing of swings) {
        if (await pathExists(swing.path)) {
          existing.push(swing);
        }
      }

      const removed = swings.length - existing.length;
      if (removed > 0) {
        await context.globalState.update(RECENT_SWINGS_STORAGE_KEY, existing);
        await commands.executeCommand(
          "setContext",
          RECENT_SWINGS_CONTEXT_KEY,
          existing.length > 0
        );
      }

      return removed;
    },
  };

  if (storage.getTemplateMRU().length > 0) {
    await commands.executeCommand("setContext", TEMPLATE_MRU_CONTEXT_KEY, true);
  }

  if (storage.getRecentTempSwings().length > 0) {
    await commands.executeCommand("setContext", RECENT_SWINGS_CONTEXT_KEY, true);
  }

  syncKeys.push(TEMPLATE_MRU_STORAGE_KEY);
  syncKeys.push(RECENT_SWINGS_STORAGE_KEY);
}
