const MODULE_URL_OVERRIDES: Record<string, string> = {
  react: "https://esm.sh/react",
  "react-dom": "https://esm.sh/react-dom",
  svelte: "https://esm.sh/svelte",
  vue: "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js",
};

export function getModuleUrl(moduleName: string) {
  if (/^https?:\/\//i.test(moduleName)) {
    return moduleName;
  }

  if (MODULE_URL_OVERRIDES[moduleName]) {
    return MODULE_URL_OVERRIDES[moduleName];
  }

  return `https://cdn.skypack.dev/${moduleName}`;
}

export async function hasDefaultExport(moduleName: string) {
  try {
    const data = await fetch(`https://cdn.skypack.dev/${moduleName}?meta`).then(
      (r) => r.json()
    );
    return data.packageExports?.["."]?.hasDefaultExport || false;
  } catch {
    // If metadata lookup fails (e.g. CDN outage), default to namespace imports
    // for safer compatibility: import * as foo from "bar".
    return false;
  }
}

const IMPORT_PATTERN = /(import\s.+\sfrom\s)(["'])(?!\.\/|http)(.+)\2/gi;
const IMPORT_SUBSTITION = `$1$2https://esm.sh/$3$2`;
export function processImports(code: string) {
  return code
    .replace(IMPORT_PATTERN, IMPORT_SUBSTITION)
    .replace(/\.\/(\S+)\.(svelte|vue|jsx|tsx|json|css)/g, "./$1.js?type=$2");
}
