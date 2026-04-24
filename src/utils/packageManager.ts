import * as vscode from "vscode";
import { SwingManifest } from "../store";

const DEFAULT_PROMPT_THROTTLE = 30 * 1000;

interface PromptHistory {
  ignoredPackages: Set<string>;
  lastPromptAt: number;
  lastSignature: string;
}

interface PromptOptions {
  manifestUri?: vscode.Uri;
  throttleMs?: number;
}

const promptHistories = new Map<string, PromptHistory>();

function getPromptHistoryKey(options?: PromptOptions) {
  return options?.manifestUri?.toString() || "global";
}

function getPackageSignature(packages: string[]) {
  return [...packages].sort((a, b) => a.localeCompare(b)).join("|");
}

/**
 * Extracts import/require statements from JavaScript/TypeScript code
 */
export function detectImportedPackages(code: string): string[] {
  const packages = new Set<string>();

  // Match ES6 imports with bindings: import x from 'pkg', import {x} from 'pkg', import * as x from 'pkg'
  const importFromRegex = /import\s+[^'"\n;]*?\sfrom\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importFromRegex.exec(code)) !== null) {
    const packageName = extractPackageName(match[1]);
    if (packageName) {
      packages.add(packageName);
    }
  }

  // Match side-effect imports: import 'pkg'
  const sideEffectImportRegex = /import\s+['"`]([^'"`]+)['"`]/g;
  while ((match = sideEffectImportRegex.exec(code)) !== null) {
    const packageName = extractPackageName(match[1]);
    if (packageName) {
      packages.add(packageName);
    }
  }

  // Match CommonJS requires: require('package') or require("package")
  const requireRegex = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((match = requireRegex.exec(code)) !== null) {
    const packageName = extractPackageName(match[1]);
    if (packageName) {
      packages.add(packageName);
    }
  }

  return Array.from(packages);
}

/**
 * Extracts the package name from an import path
 * Examples:
 *   'react' -> 'react'
 *   '@angular/core' -> '@angular/core'
 *   'lodash/map' -> 'lodash'
 *   './local/file' -> null
 */
function extractPackageName(importPath: string): string | null {
  // Ignore relative imports and built-ins
  if (importPath.startsWith('.') || importPath.startsWith('/')) {
    return null;
  }

  // Handle scoped packages (@namespace/package)
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    return parts.slice(0, 2).join('/');
  }

  // Handle regular packages (package or package/subpath)
  return importPath.split('/')[0];
}

/**
 * Finds missing packages that are imported but not in the manifest
 */
export function findMissingPackages(
  importedPackages: string[],
  manifest: SwingManifest
): string[] {
  const existingScripts = new Set([...(manifest.scripts || [])]);

  return importedPackages.filter((pkg) => {
    // Check if package is already in scripts
    if (existingScripts.has(pkg)) {
      return false;
    }

    // Check if it's a built-in or well-known library that might already be loaded
    const knownLibraries = ['react', 'react-dom', 'vue', 'svelte', 'angular'];
    if (knownLibraries.includes(pkg)) {
      // These should be in the manifest if needed
      return !existingScripts.has(pkg);
    }

    return true;
  });
}

/**
 * Shows a prompt to install missing packages
 */
export async function promptToInstallMissingPackages(
  missingPackages: string[],
  onInstall: (packages: string[]) => Promise<void>,
  options?: PromptOptions
): Promise<boolean> {
  if (missingPackages.length === 0) {
    return false;
  }

  const historyKey = getPromptHistoryKey(options);
  const history = promptHistories.get(historyKey) || {
    ignoredPackages: new Set<string>(),
    lastPromptAt: 0,
    lastSignature: "",
  };
  const throttleMs = options?.throttleMs ?? DEFAULT_PROMPT_THROTTLE;
  const signature = getPackageSignature(missingPackages);
  const now = Date.now();
  const nextPackages = missingPackages.filter(
    (pkg) => !history.ignoredPackages.has(pkg)
  );

  if (nextPackages.length === 0) {
    return false;
  }

  if (
    signature === history.lastSignature &&
    now - history.lastPromptAt < throttleMs
  ) {
    return false;
  }

  const message =
    nextPackages.length === 1
      ? `The package "${nextPackages[0]}" is imported but not in your manifest. Add it?`
      : `These packages are imported but not in your manifest:\n\n${nextPackages.map((p) => `• ${p}`).join('\n')}\n\nAdd them?`;

  history.lastPromptAt = now;
  history.lastSignature = signature;
  promptHistories.set(historyKey, history);

  const result = await vscode.window.showInformationMessage(
    message,
    { modal: false },
    "Add Packages",
    "Ignore"
  );

  if (result === "Add Packages") {
    await onInstall(nextPackages);
    return true;
  }

  if (result === "Ignore") {
    for (const pkg of nextPackages) {
      history.ignoredPackages.add(pkg);
    }
    promptHistories.set(historyKey, history);
  }

  return false;
}
