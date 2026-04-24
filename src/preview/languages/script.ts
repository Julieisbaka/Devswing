import * as path from "path";
import { TextDocument } from "vscode";
import * as config from "../../config";
import { SwingManifest } from "../../store";
import { processImports } from "../libraries/skypack";

export const SCRIPT_BASE_NAME = "script";

export const SCRIPT_LANGUAGE = {
  babel: ".babel",
  javascript: ".js",
  javascriptmodule: ".mjs",
  javascriptreact: ".jsx",
  typescript: ".ts",
  typescriptreact: ".tsx",
};

export const REACT_EXTENSIONS = [
  SCRIPT_LANGUAGE.babel,
  SCRIPT_LANGUAGE.javascriptreact,
  SCRIPT_LANGUAGE.typescriptreact,
];

const MODULE_EXTENSIONS = [SCRIPT_LANGUAGE.javascriptmodule];

const TYPESCRIPT_EXTENSIONS = [SCRIPT_LANGUAGE.typescript, ...REACT_EXTENSIONS];

export const SCRIPT_EXTENSIONS = [
  SCRIPT_LANGUAGE.javascript,
  ...MODULE_EXTENSIONS,
  ...TYPESCRIPT_EXTENSIONS,
];

export function getScriptLanguageLabel(extension: string) {
  switch (extension) {
    case SCRIPT_LANGUAGE.babel:
      return "babel";
    case SCRIPT_LANGUAGE.javascript:
      return "javascript";
    case SCRIPT_LANGUAGE.javascriptmodule:
      return "javascript module";
    case SCRIPT_LANGUAGE.javascriptreact:
      return "react jsx";
    case SCRIPT_LANGUAGE.typescript:
      return "typescript";
    case SCRIPT_LANGUAGE.typescriptreact:
      return "react tsx";
    default:
      return extension.slice(1) || "script";
  }
}

function applyLoopProtection(content: string) {
  const guardName = "__devSwingLoopProtect";
  const guardCode = `
const ${guardName} = (() => {
  const start = Date.now();
  const maxDurationMs = 2000;
  return () => {
    if (Date.now() - start > maxDurationMs) {
      throw new Error("Possible runaway loop detected. Stop execution, fix the loop condition, and run again.");
    }
  };
})();
`;

  const injectGuard = (source: string, pattern: RegExp) =>
    source.replace(pattern, (match) => `${match}${guardName}();`);

  let transformed = content;
  transformed = injectGuard(transformed, /for\s*\([^)]*\)\s*\{/g);
  transformed = injectGuard(transformed, /while\s*\([^)]*\)\s*\{/g);
  transformed = injectGuard(transformed, /do\s*\{/g);

  if (transformed === content) {
    return content;
  }

  return `${guardCode}\n${transformed}`;
}

export function isReactFile(fileName: string) {
  return REACT_EXTENSIONS.includes(path.extname(fileName));
}

export const REACT_SCRIPTS = ["react", "react-dom"];

export function includesReactFiles(files: string[]) {
  return files.some(isReactFile);
}

export function includesReactScripts(scripts: string[]) {
  return REACT_SCRIPTS.every((script) => scripts.includes(script));
}

export function getScriptContent(
  document: TextDocument,
  manifest: SwingManifest | undefined
): [string, boolean] | null {
  const extension = path.extname(document.uri.path).toLocaleLowerCase();
  let isModule = MODULE_EXTENSIONS.includes(extension);

  const content = document.getText();
  if (content.trim() === "") {
    return [content, isModule];
  } else if (manifest?.scriptType === "module") {
    isModule = true;
  } else {
    isModule = isModule || content.trim().startsWith("import ");
  }

  const includesJsx =
    manifest && manifest.scripts && manifest.scripts.includes("react");

  const compileComponent = compileScriptContent(
    content,
    extension,
    isModule,
    includesJsx
  );
  return compileComponent ? [compileComponent, isModule] : null;
}

export function compileScriptContent(
  content: string,
  extension: string,
  isModule: boolean = true,
  includesJsx: boolean = true
): string | null {
  if (isModule) {
    if (includesJsx) {
      // React can only be imported into the page once, and so if the user's
      // code is trying to import it, we need to replace that import statement.
      content = content
        .replace(/import (?:\* as )?React from (["'])react\1/, "")
        .replace(/import (?:\* as )?ReactDOM from (["'])react-dom\1/, "")
        .replace(
          /import React, {(.+)} from (["'])react\2/,
          "const {$1} = React"
        )
        .replace(/import (.+) from (["'])react\2/, "const $1 = React")
        .replace(
          /from (["'])react-native\1/,
          "from $1https://gistcdn.githack.com/lostintangent/6de9be49a0f112dd36eff3b8bc771b9e/raw/ce12b9075322245be20a79eba4d89d4e5152a4aa/index.js$1"
        );
    }

    content = processImports(content);
  }

  const containsJsx =
    includesJsx || content.match(/import .* from (["'])react\1/) !== null;

  let compiledContent: string;

  if (TYPESCRIPT_EXTENSIONS.includes(extension) || containsJsx) {
    const typescript = require("typescript");
    const compilerOptions: any = {
      experimentalDecorators: true,
      target: "ES2018",
    };

    if (REACT_EXTENSIONS.includes(extension) || containsJsx) {
      compilerOptions.jsx = typescript.JsxEmit.React;
    }

    try {
      compiledContent = typescript.transpile(content, compilerOptions);
    } catch (e) {
      // Something failed when trying to transpile Pug,
      // so don't attempt to return anything
      return null;
    }
  } else {
    compiledContent = content;
  }

  return config.get("loopProtection")
    ? applyLoopProtection(compiledContent)
    : compiledContent;
}
