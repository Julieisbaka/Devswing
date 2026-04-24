import { TextDocument } from "vscode";
import { getScriptContent } from "../script";

function getComponentName(code: string) {
    const match = code.match(/export\s+default\s+(?:(?:class|function)\s+)?(\w+)/);
    return match ? match[1] : undefined;
}

export async function compileComponent(content: string, document: TextDocument) {
    const scriptContent = await getScriptContent(document, { scripts: ["react"] });
    if (!scriptContent) {
      throw new Error("Unable to compile React component script.");
    }

    const [code] = scriptContent;
    const componentName = getComponentName(code);
    if (!componentName) {
      throw new Error(
        "React component must export a named default class/function (for example: export default function App() {})."
      );
    }

    const isReactNative = code.includes("6de9be49a0f112dd36eff3b8bc771b9e");
    const init = isReactNative ? `import { AppRegistry } from "https://gistcdn.githack.com/lostintangent/6de9be49a0f112dd36eff3b8bc771b9e/raw/ce12b9075322245be20a79eba4d89d4e5152a4aa/index.js";
    AppRegistry.registerComponent("App", () => ${componentName});
    
    AppRegistry.runApplication("App", {
      rootTag: document.getElementById("app")
    });` : `ReactDOM.render(React.createElement(${componentName}), document.getElementById("app"));`;
    return [code, init];
}
