import * as path from "path";
import themeStyles from "raw-loader!./stylesheets/themeStyles.css";
import * as vscode from "vscode";
import { openSwing } from ".";
import * as config from "../config";
import { URI_PATTERN } from "../constants";
import { store, SwingLibraryType, SwingManifest } from "../store";
import { byteArrayToString } from "../utils";
import { getScriptContent, getScriptLanguageLabel } from "./languages/script";
import { getCdnJsLibraries } from "./libraries/cdnjs";
import { ProxyFileSystemProvider } from "./proxyFileSystemProvider";
import { storage } from "./tutorials/storage";

const EXIT_RESPONSE = "Exit Swing";

export interface SwingWebViewUpdates {
  css?: string;
  input?: string;
  errorOverlay?: string | null;
}

export class SwingWebView {
  private css: string = "";
  private html: string = "";
  private javascript: string = "";
  private isJavaScriptModule: boolean = false;
  private manifest: SwingManifest | undefined;
  private readme: string = "";
  private config: string = "";
  private input: string = "";

  constructor(
    private webview: vscode.Webview,
    private output: vscode.OutputChannel,
    private swing: vscode.Uri,
    private codePenScripts: string = "",
    private codePenStyles: string = "",
    private totalTutorialSteps?: number,
    private tutorialTitle?: string
  ) {
    webview.onDidReceiveMessage(async ({ command, value }) => {
      switch (command) {
        case "alert":
          if (value) {
            vscode.window.showInformationMessage(value);
          }
          break;

        case "clear":
          output.clear();
          break;

        case "log":
          output.appendLine(value);
          break;

        case "httpRequest": {
          const decodeRequestBody = (
            body: any,
            bodyEncoding: string | undefined
          ): any => {
            switch (bodyEncoding) {
              case "none":
              case undefined:
                return body || undefined;
              case "text":
              case "json":
                return body;
              case "urlsearchparams":
                return new URLSearchParams(body || "");
              case "formdata": {
                const formData = new FormData();
                for (const [name, value] of body || []) {
                  formData.append(name, value);
                }
                return formData;
              }
              case "arraybuffer":
                return Uint8Array.from(body || []).buffer;
              case "uint8array":
                return Uint8Array.from(body || []);
              default:
                return body;
            }
          };

          const encodeResponseBody = (
            data: string | Uint8Array,
            responseType: string | undefined
          ): { body: any; bodyEncoding: string } => {
            if (responseType === "arraybuffer") {
              const bytes =
                data instanceof Uint8Array
                  ? data
                  : new TextEncoder().encode(data);
              return {
                body: Array.from(bytes),
                bodyEncoding: "arraybuffer",
              };
            }

            return {
              body:
                typeof data === "string" ? data : byteArrayToString(data),
              bodyEncoding: "text",
            };
          };

          const requestBody = decodeRequestBody(value.body, value.bodyEncoding);

          let response: {
            data: string | Uint8Array;
            status: number;
            statusText: string;
            headers?: Record<string, string>;
          };
          if (value.url.startsWith("http")) {
            const fetchResponse = await fetch(value.url, {
              method: value.method,
              body: requestBody,
              headers: JSON.parse(value.headers || "{}"),
            });
            const data =
              value.responseType === "arraybuffer"
                ? new Uint8Array(await fetchResponse.arrayBuffer())
                : await fetchResponse.text();
            response = {
              data,
              status: fetchResponse.status,
              statusText: fetchResponse.statusText,
              headers: Object.fromEntries(fetchResponse.headers.entries()),
            };
          } else {
            const uri = vscode.Uri.joinPath(this.swing, value.url);
            const contents = await vscode.workspace.fs.readFile(uri);
            response = {
              data: byteArrayToString(contents),
              status: 200,
              statusText: "OK",
              headers: {},
            };
          }

          const { body, bodyEncoding } = encodeResponseBody(
            response.data,
            value.responseType
          );

          webview.postMessage({
            command: "httpResponse",
            value: {
              id: value.id,
              body,
              bodyEncoding,
              responseType: value.responseType,
              status: response.status,
              statusText: response.statusText,
              source: value.source,
              headers: JSON.stringify(response.headers || {}),
            },
          });
          break;
        }

        case "navigateCode": {
          const file = vscode.Uri.joinPath(swing, value.file);
          let editor = vscode.window.visibleTextEditors.find(
            (editor) => editor.document.uri.toString() === file.toString()
          );

          const line = value.line - 1;
          const column = value.column - 1;
          const range = new vscode.Range(line, column, line, 1000);

          if (editor) {
            editor.selection = new vscode.Selection(range.start, range.end);
          } else {
            editor = await vscode.window.showTextDocument(file, {
              selection: range,
              preserveFocus: false,
            });
          }

          editor.revealRange(range);
          break;
        }

        case "navigateTutorial": {
          const currentStep = storage.currentTutorialStep();
          const nextStep = currentStep + value;

          // Save all open files, to prevent the user
          // from getting a save dialog upon navigation.
          await vscode.workspace.saveAll();

          if (nextStep <= this.totalTutorialSteps!) {
            await storage.setCurrentTutorialStep(nextStep);
            openSwing(store.activeSwing!.rootUri);
          } else {
            const completionMessage =
              this.manifest!.input && this.manifest!.input!.completionMessage
                ? this.manifest!.input!.completionMessage
                : "Congratulations! You're completed this tutorial";

            const response = await vscode.window.showInformationMessage(
              completionMessage,
              { modal: true },
              EXIT_RESPONSE
            );

            if (response === EXIT_RESPONSE) {
              return store.activeSwing?.webViewPanel.dispose();
            }
          }
          break;
        }

        case "openUrl": {
          if ((value as string).startsWith("http")) {
            vscode.env.openExternal(vscode.Uri.parse(value));
          } else {
            const uri = vscode.Uri.joinPath(store.activeSwing!.rootUri, value);
            await vscode.commands.executeCommand(
              "simpleBrowser.api.open",
              uri,
              {
                viewColumn: vscode.ViewColumn.Beside,
              }
            );
          }
          break;
        }

        case "updateTitle": {
          const title = value;
          store.activeSwing!.webViewPanel.title = `DevSwing (${title})`;
          break;
        }
      }
    });
  }

  public updateCSS(css: string, rebuild = false) {
    this.css = css;

    if (rebuild) {
      this.applyUpdates({ css });
    }
  }

  public updateInput(input: string, rebuild = false) {
    this.input = input;

    if (rebuild) {
      this.applyUpdates({ input });
    }
  }

  public applyUpdates(updates: SwingWebViewUpdates) {
    if (updates.css !== undefined) {
      this.css = updates.css;
    }

    if (updates.input !== undefined) {
      this.input = updates.input;
    }

    this.webview.postMessage({ command: "batchUpdate", value: updates });
  }

  public async updateReadme(readme: string, rebuild = false) {
    this.readme = readme;

    if (rebuild) {
      await this.rebuildWebview();
    }
  }

  public async updateConfig(config: string, rebuild = false) {
    this.config = config;

    if (rebuild) {
      await this.rebuildWebview();
    }
  }

  public async updateHTML(html: string, rebuild = false) {
    this.html = html;

    if (rebuild) {
      await this.rebuildWebview();
    }
  }

  public async updateJavaScript(
    textDocument: vscode.TextDocument,
    rebuild = false
  ): Promise<boolean> {
    const data = getScriptContent(textDocument, this.manifest);
    if (data === null) {
      const fileName = path.basename(textDocument.uri.fsPath);
      const extension = path.extname(fileName).toLocaleLowerCase();
      const language = getScriptLanguageLabel(extension);
      this.output.appendLine(
        `Failed to compile script file '${fileName}' (language: ${language}).`
      );
      this.showErrorOverlay(
        `Failed to compile '${fileName}' (${language}). Check the DevSwing output for details.`
      );
      return false;
    }

    this.javascript = data[0];
    this.isJavaScriptModule = data[1];
    this.hideErrorOverlay();

    if (rebuild) {
      await this.rebuildWebview();
    }

    return true;
  }

  public async updateManifest(manifest: string, rebuild = false) {
    if (!manifest) {
      return;
    }

    try {
      this.manifest = JSON.parse(manifest);

      if (rebuild) {
        await this.rebuildWebview();
      }
    } catch (e) {
      // The user might have typed invalid JSON
    }
  }

  public showErrorOverlay(message: string) {
    this.applyUpdates({ errorOverlay: message });
  }

  public hideErrorOverlay() {
    this.applyUpdates({ errorOverlay: null });
  }

  private async resolveLibraries(libraryType: SwingLibraryType) {
    let libraries =
      libraryType === SwingLibraryType.script
        ? this.codePenScripts
        : this.codePenStyles;

    if (
      !this.manifest ||
      !this.manifest[libraryType] ||
      this.manifest[libraryType]!.length === 0
    ) {
      return libraries;
    }

    await Promise.all(
      this.manifest![libraryType]!.map(async (library) => {
        if (!library || (library && !library.trim())) {
          return;
        }

        const appendLibrary = (url: string) => {
          if (libraryType === SwingLibraryType.style) {
            libraries += `<link href="${url}" rel="stylesheet" />`;
          } else {
            libraries += `<script src="${url}"></script>`;
          }
        };

        const isUrl = library.match(URI_PATTERN);
        if (isUrl) {
          appendLibrary(library);
        } else {
          const libraries = await getCdnJsLibraries();
          const libraryEntry = libraries.find((lib) => lib.name === library);

          if (!libraryEntry) {
            return;
          }

          appendLibrary(libraryEntry.latest);
        }
      })
    );

    return libraries;
  }

  public async rebuildWebview() {
    if (config.get("clearConsoleOnRun")) {
      this.output.clear();
    }

    // The URL needs to have a trailing slash, or end the URLs could get messed up.
    const baseUrl = this.webview
      .asWebviewUri(
        ProxyFileSystemProvider.getProxyUri(
          vscode.Uri.joinPath(this.swing, "/")
        )
      )
      .toString();
    const styleId = `swing-style-${Math.random()}`;

    const scripts = await this.resolveLibraries(SwingLibraryType.script);
    const styles = await this.resolveLibraries(SwingLibraryType.style);

    const scriptType = this.isJavaScriptModule
      ? "module"
      : (this.manifest?.scriptType || "text/javascript");

    const readmeBehavior =
      (this.manifest && this.manifest.readmeBehavior) ||
      (await config.get("readmeBehavior"));

    const header = readmeBehavior === "previewHeader" ? this.readme : "";
    const footer = readmeBehavior === "previewFooter" ? this.readme : "";

    const shouldUseThemeStyles =
      this.manifest?.themePreview ?? config.get("themePreview");

    // TODO: Refactor this out to a "tutorial renderer" that
    // can handle all of the tutorial-specific UI and behavior
    let title = "";
    let tutorialNavigation = "";
    if (this.totalTutorialSteps) {
      const currentTutorialStep = storage.currentTutorialStep();
      if (this.tutorialTitle) {
        title = `<span style='font-weight: bold'>${this.tutorialTitle}</span>`;
      }
      const frame = `<html>
    <head>
      <style>

        navigation {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        button {
          min-width: 26px;
          height: 24px;
          border: 1px solid #888;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
        }

        button[disabled] {
          opacity: 0.5;
          cursor: default;
        }

        button + button {
          margin-left: 6px;
        }

        span {
          margin: 0 5px;
        }

        ${shouldUseThemeStyles ? themeStyles : ""}

      </style>
      <script>

      function navigateTutorial(step) {
        parent.postMessage({
          command: 'navigateTutorial',
          value: step
        }, '*');
      }

      </script>
    </head>
    <body>
      <navigation>
      ${title}
      <div>
      <button type='button' onclick='navigateTutorial(-1)' ${
        currentTutorialStep === 1 ? "disabled" : ""
      } aria-label='Previous step'>&larr;</button>
      <span>Step ${currentTutorialStep} of ${this.totalTutorialSteps}</span>
      <button type='button' onclick='navigateTutorial(1)' ${
        currentTutorialStep === this.totalTutorialSteps ? "disabled" : ""
      } aria-label='Next step'>&rarr;</button>
      </div>
      </navigation>
    </body>
</html>
`;

      tutorialNavigation = `<iframe id="tutorial-navigation" srcdoc="${frame}"></iframe>`;
    }

    this.webview.html = `<html>
  <head>
    <base href="${baseUrl}" />
    <meta charset="UTF-8" />
    <title>DevSwing</title>
    <style>

      html, body {
        height: 100%;
        width: 100%;
      }
      
      body {
        background-color: white;
        font-size: var(---vscode-font-size);
        padding: 0;
      }

      iframe#tutorial-navigation {
        height: 30px;
        width: calc(100% - 20px);
        border: none;
        padding-bottom: 10px;
        border-bottom: 1px solid black;
      }

      #devswing-error-overlay {
        display: none;
        position: fixed;
        inset: 12px;
        z-index: 999999;
        background: color-mix(in srgb, var(--vscode-editor-background) 96%, #b00020 4%);
        border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 80%, var(--vscode-editor-foreground) 20%);
        border-radius: 8px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
        padding: 14px;
        font-family: var(--vscode-font-family);
        overflow: auto;
      }

      #devswing-error-overlay pre {
        white-space: pre-wrap;
        user-select: text;
      }
      ${shouldUseThemeStyles ? themeStyles : ""}
    </style>
    ${styles}
    <style id="${styleId}">
      ${this.css}
    </style>
    <script src="https://cdn.jsdelivr.net/npm/mock-xmlhttprequest@5.1.0/dist/mock-xmlhttprequest.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/fetch-mock/es5/client-bundle.js"></script>
    <script>

    // Wrap this code in braces, so that none of the variables
    // conflict with variables created by a swing's scripts.
    {
      document.getElementById("_defaultStyles").remove();

      const vscode = acquireVsCodeApi();
      const style = document.getElementById("${styleId}");
      
      window.addEventListener("DOMContentLoaded", () => {
        const linkedStyle = document.querySelector("link[href='style.css']");
        if (linkedStyle) {
          linkedStyle.parentElement.removeChild(linkedStyle);
        }

        const linkedScript = document.querySelector("script[src='script.js']");
        if (linkedScript) {
          linkedScript.parentElement.removeChild(linkedScript);
        }

        const observer = new MutationObserver(() => {
          vscode.postMessage({
            command: "updateTitle",
            value: document.title
          });
        });
        observer.observe(document.querySelector("title"), { attributes: true, childList: true, subtree: true });
      });
  
      let httpRequestId = 1;
      const pendingHttpRequests = new Map();
      const pendingFetchRequests = new Map();

      function serializeRequestBody(body) {
        if (body == null) {
          return { body: undefined, bodyEncoding: "none" };
        }

        if (typeof body === "string") {
          return { body, bodyEncoding: "text" };
        }

        if (body instanceof URLSearchParams) {
          return { body: body.toString(), bodyEncoding: "urlsearchparams" };
        }

        if (body instanceof FormData) {
          return {
            body: Array.from(body.entries()).map(([name, value]) => [
              name,
              typeof value === "string" ? value : value.name,
            ]),
            bodyEncoding: "formdata",
          };
        }

        if (body instanceof ArrayBuffer) {
          return {
            body: Array.from(new Uint8Array(body)),
            bodyEncoding: "arraybuffer",
          };
        }

        if (ArrayBuffer.isView(body)) {
          return {
            body: Array.from(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)),
            bodyEncoding: "uint8array",
          };
        }

        if (typeof body === "object") {
          return { body: JSON.stringify(body), bodyEncoding: "json" };
        }

        return { body: String(body), bodyEncoding: "text" };
      }

      function deserializeResponseBody(body, bodyEncoding, responseType) {
        if (bodyEncoding === "arraybuffer") {
          return Uint8Array.from(body || []).buffer;
        }

        if (responseType === "arraybuffer") {
          if (Array.isArray(body)) {
            return Uint8Array.from(body).buffer;
          }

          if (typeof body === "string") {
            return new TextEncoder().encode(body).buffer;
          }
        }

        return body;
      }

      window.addEventListener("message", ({ data }) => {  
        if (data.command === "batchUpdate") {
          applyBatchUpdate(data.value || {});
        } else if (data.command === "updateCSS") {
          style.textContent = data.value;
        } else if (data.command === "httpResponse") {
          const id = data.value.id;
          const status = data.value.status;
          const headers = JSON.parse(data.value.headers);
          const body = deserializeResponseBody(
            data.value.body,
            data.value.bodyEncoding,
            data.value.responseType
          );

          if (data.value.source === "fetch") { 
            const resolve = pendingFetchRequests.get(id);
            resolve(new Response(body, { status, headers }));
            pendingFetchRequests.delete(id);
          } else {
            const xhr = pendingHttpRequests.get(id);
            xhr.respond(status, headers, body, data.value.statusText);
            pendingHttpRequests.delete(id);
          }
        } else if (data.command === "updateInput") {
          triggerInput(data.value)
        } else if (data.command === "navigateTutorial") {
          navigateTutorial(data.value);
        } else if (data.command === "showErrorOverlay") {
          showErrorOverlay(data.value);
        } else if (data.command === "hideErrorOverlay") {
          hideErrorOverlay();
        }
      });

      function applyBatchUpdate(value) {
        if (Object.prototype.hasOwnProperty.call(value, "css")) {
          style.textContent = value.css || "";
        }

        if (Object.prototype.hasOwnProperty.call(value, "input")) {
          triggerInput(value.input || "");
        }

        if (Object.prototype.hasOwnProperty.call(value, "errorOverlay")) {
          if (value.errorOverlay) {
            showErrorOverlay(value.errorOverlay);
          } else {
            hideErrorOverlay();
          }
        }
      }

      function showErrorOverlay(message) {
        const overlay = document.getElementById("devswing-error-overlay");
        const text = document.getElementById("devswing-error-overlay-message");
        text.textContent = message || "Unknown preview error";
        overlay.style.display = "block";
      }

      function hideErrorOverlay() {
        const overlay = document.getElementById("devswing-error-overlay");
        overlay.style.display = "none";
      }

      window.addEventListener("error", (event) => {
        const reason = event?.error?.stack || event?.error?.message || event.message || "Unknown runtime error";
        showErrorOverlay("Preview runtime error:\n" + reason + "\n\nTip: If this was caused by a runaway loop, fix the loop condition and run the swing again.");
      });

      window.addEventListener("unhandledrejection", (event) => {
        const reason = event?.reason?.stack || event?.reason?.message || String(event?.reason || "Unhandled promise rejection");
        showErrorOverlay("Preview runtime error:\n" + reason);
      });
    
      function navigateTutorial(step) {
        vscode.postMessage({
          command: "navigateTutorial",
          value: step
        });
      }

      function triggerInput(input) {
        if (window.checkInput && window.checkInput(input)) {
          navigateTutorial(1);
        }
      }

      function serializeMessage(message) {
        if (typeof message === "string") {
          return message;
        } else {
          return JSON.stringify(message);
        }
      }

      window.alert = (message) => {
        const value = serializeMessage(message);
        vscode.postMessage({
          command: "alert",
          value
        });
      };

      window.open = (url) => {
        vscode.postMessage({
          command: "openUrl",
          value: url
        });
      }

      console.clear = () => {
        vscode.postMessage({
          command: "clear",
          value: ""
        });
      };

      const originalLog = console.log;
      console.log = (...args) => {
        const value = (args || [undefined]).map(serializeMessage).join('\\t');
        vscode.postMessage({
          command: "log",
          value
        });
        
        originalLog.call(console, ...args);
      };

      const mockXHRServer = MockXMLHttpRequest.newServer();
      mockXHRServer.setDefaultHandler((xhr) => {
        const serializedBody = serializeRequestBody(xhr.body);

        pendingHttpRequests.set(httpRequestId, xhr);
        vscode.postMessage({
          command: "httpRequest",
          value: {
            id: httpRequestId++,
            url: xhr.url,
            method: xhr.method,
            body: serializedBody.body,
            bodyEncoding: serializedBody.bodyEncoding,
            responseType: xhr.responseType,
            headers: JSON.stringify(xhr.headers || {}),
            source: "xhr"
          }
        });
      });
      mockXHRServer.install(window);

      fetchMock.any((url, options = {}) => {
        return new Promise(async (resolve) => {
          const serializedBody = serializeRequestBody(options.body);

          pendingFetchRequests.set(httpRequestId, resolve);
          vscode.postMessage({
            command: "httpRequest",
            value: {
              id: httpRequestId++,
              url,
              method: options.method,
              body: serializedBody.body,
              bodyEncoding: serializedBody.bodyEncoding,
              headers: JSON.stringify(options.headers || {}),
              source: "fetch"
            }
          });
        });
      });

      const LINK_PREFIX = "swing:";
      document.addEventListener("click", (e) => {
        if (e.target.href) {
          e.preventDefault();

          if (e.target.href.startsWith(LINK_PREFIX)) {
            const href = e.target.href.replace(LINK_PREFIX, "");
            const [file, lineColumn] = href.split("@");
            const [line, column] = lineColumn ? lineColumn.split(":") : [];

            vscode.postMessage({
              command: "navigateCode",
              value: {
                file, 
                line: Number(line) || 1,
                column: Number(column) || 1
              }
            });
          } else if (!e.target.href.startsWith("http")) {
            vscode.postMessage({
              command: "openUrl",
              value: e.target.href
            });
          }
        }
      });

      const config = \`${this.config}\`;
      if (config) {
        try {
        window.config = JSON.parse(config);
        } catch {
          alert("The swing's config file isn't valid JSON.");
        }
      }

      const input = "${this.input}";
      if (input) {
        triggerInput(input);
      }
    }

    </script>
  </head>
  <body>
    <div id="devswing-error-overlay" role="alert" aria-live="assertive">
      <h3>Preview error</h3>
      <pre id="devswing-error-overlay-message"></pre>
    </div>
    ${scripts}
    ${tutorialNavigation}
    ${header}
    ${this.html}
    ${footer}
    <script type="${scriptType}">
      ${this.javascript}
    </script>
  </body>
</html>`;
  }
}
