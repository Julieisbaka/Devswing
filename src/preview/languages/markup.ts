import * as path from "path";
import { TextDocument } from "vscode";
import { getModuleUrl, processImports } from "../libraries/skypack";
import { compileCode, getExtensions } from "./languageProvider";
import { REACT_EXTENSIONS } from "./script";

const MARKUP_BASE_NAMES = ["index", "App", "main"];

const MARKUP_LANGUAGE = {
  html: ".html",
  markdown: ".md",
  pug: ".pug",
  vue: ".vue",
  svelte: ".svelte",
  go: ".go",
};

const COMPONENT_EXTENSIONS = [
  MARKUP_LANGUAGE.vue,
  MARKUP_LANGUAGE.svelte,
  ...REACT_EXTENSIONS,
];

const MARKUP_EXTENSIONS = [
  MARKUP_LANGUAGE.html,
  MARKUP_LANGUAGE.markdown,
  MARKUP_LANGUAGE.pug,
  MARKUP_LANGUAGE.go,
  ...COMPONENT_EXTENSIONS,
];

function getMarkupExtensions() {
  const customExtensions = getExtensions("markup");
  return [...MARKUP_EXTENSIONS, ...customExtensions];
}

export function getCandidateMarkupFilenames() {
  return getMarkupExtensions().flatMap((extension) =>
    MARKUP_BASE_NAMES.map((baseName) => `${baseName}${extension}`)
  );
}

function getComponentType(extension: string): string | undefined {
  switch (extension) {
    case ".jsx":
    case ".tsx":
      return "react";
    case ".vue":
      return "vue";
    case ".svelte":
      return "svelte";
    default:
      return undefined;
  }
}

function escapeInlineScript(code: string) {
  return code.replace(/<\/script>/gi, "<\\/script>");
}

export async function getMarkupContent(
  document: TextDocument
): Promise<string | null> {
  const content = document.getText();
  if (content.trim() === "") {
    return content;
  }

  const extension = path.extname(document.uri.path).toLocaleLowerCase();
  if (COMPONENT_EXTENSIONS.includes(extension)) {
    const componentType = getComponentType(extension);
    if (!componentType) {
      throw new Error(`Unsupported component extension '${extension}'.`);
    }

    const { compileComponent } = require(`./components/${componentType}`);
    const [component, appInit, imports] = await compileComponent(content, document);
    const code = escapeInlineScript(processImports(component));
    const appInitialization = escapeInlineScript(appInit);
    const importCode = imports
      ? imports
          .map(([name, lib]: any) => `import ${name} from "${getModuleUrl(lib)}";`)
          .join("\n")
      : "";

    return `<div id="app"></div>
<script type="module">
  ${importCode}
  ${code}
  ${appInitialization}
</script>`;
  } else if (extension === MARKUP_LANGUAGE.go) {
    const { compileGo } = require("./go");
    return await compileGo(content, document.uri);
  }

  switch (extension) {
    case MARKUP_LANGUAGE.pug:
      const pug = require("pug");
      return pug.render(content);
    case MARKUP_LANGUAGE.markdown:
      const markdown = require("markdown-it")();
      return markdown.render(content, { html: true });
    case MARKUP_LANGUAGE.html:
      return content;
    default:
      return compileCode("markup", extension, content);
  }
}
