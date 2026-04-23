import { TextDocument } from "vscode";
import { getScriptContent } from "../script";

function getComponentName(code: string) {
  const match = code.match(/export\s+(?:default\s+)?(?:class|function)\s+(\w+)/);
  return match ? match[1] : "AppComponent";
}

export async function compileComponent(content: string, document: TextDocument) {
  const [code] = (await getScriptContent(document, {
    scripts: [
      "https://unpkg.com/@angular/core@latest/bundles/core.umd.js",
      "https://unpkg.com/@angular/common@latest/bundles/common.umd.js",
      "https://unpkg.com/@angular/platform-browser@latest/bundles/platform-browser.umd.js",
      "https://unpkg.com/@angular/platform-browser-dynamic@latest/bundles/platform-browser-dynamic.umd.js"
    ]
  }))!;

  const componentName = getComponentName(code);

  // Ensure the component is exported as default
  let componentCode = code;
  if (!componentCode.includes("export default")) {
    componentCode = componentCode.replace(
      new RegExp(`(export\\s+)?(class|function)\\s+${componentName}`),
      `export default $2 ${componentName}`
    );
  }

  // Create the module and bootstrap code
  const init = `
const { NgModule, Component } = ng.core;
const { platformBrowserDynamic } = ng.platformBrowserDynamic;
const { BrowserModule } = ng.platform_browser;

// Get the actual component class
const ActualComponent = ${componentName};

@NgModule({
  declarations: [ActualComponent],
  imports: [BrowserModule],
  bootstrap: [ActualComponent]
})
class AppModule { }

// Bootstrap the module
platformBrowserDynamic().bootstrapModule(AppModule).catch(err => console.error(err));
  `;

  return [componentCode, init];
}
