const LIBRARIES_URL = "https://api.cdnjs.com/libraries";

export interface CdnJsLibrary {
  name: string;
  description: string;
  latest: string;
}

export interface CdnJsLibraryVersion {
  version: string;
  files: string[];
}

let libraries: CdnJsLibrary[] | undefined;
async function getLibrariesInternal(): Promise<CdnJsLibrary[]> {
  try {
    const data = await fetch(`${LIBRARIES_URL}?fields=description`).then((r) => r.json()) as { results: CdnJsLibrary[] };
    libraries = data.results;
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

  if (currentGetLibrariesPromise) {
    return await currentGetLibrariesPromise;
  }

  currentGetLibrariesPromise = getLibrariesInternal();
  return await currentGetLibrariesPromise;
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
