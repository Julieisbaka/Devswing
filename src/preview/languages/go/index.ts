import * as vscode from "vscode";

const COMPILE_URL = "https://go.dev/_/compile";
const CONTENT_TYPE_HEADER = "Content-Type";

const ERROR_PATTERN = /^\.\/prog.go:(?<line>\d+):(?<column>\d+):\s*(?<message>.+)$/gim;
let diagnosticCollection: vscode.DiagnosticCollection | undefined;
export async function compileGo(code: string, documentUri: vscode.Uri) {
  try {
    if (diagnosticCollection) {
      diagnosticCollection.dispose();
      diagnosticCollection = undefined;
    }

    const data = new URLSearchParams({
      body: code,
      version: "2",
      withVet: "true",
    });

    const response = await fetch(COMPILE_URL, {
      method: "POST",
      headers: {
        [CONTENT_TYPE_HEADER]: "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: data.toString(),
    });

    // The service returns "text/plain" as the content type,
    // so we parse the response payload manually as JSON.
    const responseText = await response.text();
    const serviceResponse = JSON.parse(responseText) as any;
    const rawErrors = serviceResponse.Errors as string | undefined;
    const serviceEvents = (serviceResponse.Events || []) as any[];
    const events = serviceEvents.map((event) => ({
      message: String(event.Message ?? ""),
      kind: String(event.Kind ?? ""),
      delay: Number(event.Delay ?? 0),
    }));

    let errors = rawErrors;
    if (errors) {
      diagnosticCollection = vscode.languages.createDiagnosticCollection(
        "DevSwing"
      );

      let match,
        diagnostics: vscode.Diagnostic[] = [];

      while ((match = ERROR_PATTERN.exec(errors)) !== null) {
        const { line, column, message } = match.groups!;
        const lineNumber = parseInt(line) - 1;
        const columnNumber = parseInt(column) - 1;

        diagnostics.push(
          new vscode.Diagnostic(
            new vscode.Range(
              lineNumber,
              columnNumber,
              lineNumber,
              columnNumber
            ),
            message,
            vscode.DiagnosticSeverity.Error
          )
        );
      }

      console.log("Diagnostics: ", diagnostics);
      diagnosticCollection.set(documentUri, diagnostics);

      errors = errors.replace(/\.\/prog.go/g, "main.go");
    }

    return `<pre id="events"></pre>
<script>
  
  (async function loadEvents() {
    const errors = ${JSON.stringify(errors)};
    const events = ${JSON.stringify(events)};
    const container = document.getElementById("events");

    if (errors) {
      container.innerHTML += errors.replace(/\\n/g, "<br />")
      return;
    }

    for (let { message, delay } of events) {
      console.log(delay);
      if (delay > 0) {
        // The service returns delays in nanoseconds,
        // and so we need to convert it to milliseconds
        const timeout = delay / 1000000;
        await new Promise((resolve) => setTimeout(resolve, timeout));
      }

      const renderedMessage = message.replace(/(?:\\r\\n|\\r|\\n)/g, "<br />");
      if (renderedMessage.startsWith("\f")) {
        container.innerHTML = renderedMessage.substring(1);
      } else if (renderedMessage.startsWith("IMAGE:")) {
        const imageContents = renderedMessage.substring(6);
        container.innerHTML = \`<img src="data:image/png;base64,\${imageContents}" />\`;
      } else {
        container.innerHTML += renderedMessage;
      } 
    }
  })();

</script>`;
  } catch (e) {
    console.log("Error: ", e);
  }
}
