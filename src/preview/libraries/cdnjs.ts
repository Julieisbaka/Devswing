import * as vscode from "vscode";

const LIBRARIES_URL = "https://api.cdnjs.com/libraries";
const LIBRARIES_CACHE_KEY = "devswing:cdnjsLibraries";
const LIBRARIES_CACHE_TTL = 24 * 60 * 60 * 1000;

export interface CdnJsLibrary {
  name: string;
  description: string;
  latest: string;
}

export interface CdnJsLibraryVersion {
  version: string;
  files: string[];
}

interface CdnJsLibraryCache {
  libraries: CdnJsLibrary[];
  updatedAt: number;
}

let libraries: CdnJsLibrary[] | undefined;
let globalState: vscode.Memento | undefined;

export function initializeCdnJsCache(state: vscode.Memento) {
  globalState = state;
}

function getCachedLibraries(): CdnJsLibrary[] | undefined {
  const cached = globalState?.get<CdnJsLibraryCache>(LIBRARIES_CACHE_KEY);
  if (!cached || !Array.isArray(cached.libraries)) {
    return undefined;
  }

  if (Date.now() - cached.updatedAt > LIBRARIES_CACHE_TTL) {
    return undefined;
  }

  libraries = cached.libraries;
  return libraries;
}

async function setCachedLibraries(nextLibraries: CdnJsLibrary[]) {
  await globalState?.update(LIBRARIES_CACHE_KEY, {
    libraries: nextLibraries,
    updatedAt: Date.now(),
  } satisfies CdnJsLibraryCache);
}

async function getLibrariesInternal(): Promise<CdnJsLibrary[]> {
  try {
    const data = await fetch(`${LIBRARIES_URL}?fields=description`).then((r) => r.json()) as { results: CdnJsLibrary[] };
    libraries = data.results;
    await setCachedLibraries(libraries);
    return libraries;
  } catch {
    throw new Error("Cannot get the libraries.");
  }
}

let currentGetLibrariesPromise: Promise<CdnJsLibrary[]> | undefined;
export async function getCdnJsLibraries() {
  if (libraries) {
    return libraries;
  }

  const cachedLibraries = getCachedLibraries();
  if (cachedLibraries) {
    return cachedLibraries;
  }

  if (currentGetLibrariesPromise) {
    return await currentGetLibrariesPromise;
  }

  currentGetLibrariesPromise = getLibrariesInternal();
  try {
    return await currentGetLibrariesPromise;
  } finally {
    currentGetLibrariesPromise = undefined;
  }
}

export async function getLibraryVersions(
  libraryName: string
): Promise<CdnJsLibraryVersion[]> {
  try {
    const data = await fetch(`${LIBRARIES_URL}/${libraryName}?fields=assets`).then((r) => r.json());
    return (data.assets as CdnJsLibraryVersion[]).reverse();
  } catch {
    return [];
  }
}

export async function searchPackages(searchString: string) {
  const data = await fetch(`${LIBRARIES_URL}?search=${searchString}`).then((r) => r.json()) as { results: CdnJsLibrary[] };
  return data.results;
}
