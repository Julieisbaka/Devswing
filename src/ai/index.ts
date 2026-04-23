import * as vscode from "vscode";
import { SwingFile } from "../store";

const SYSTEM_PROMPT = `You are a web development assistant. Generate complete, working web swing files when asked.
A "swing" is a small self-contained web application consisting of HTML, CSS, and/or JavaScript files.

Respond ONLY with file contents using this exact format — no prose, no explanations:
<<—[filename]=
<full file content>
—>>

Rules:
- Use "index.html" for HTML, "style.css" for CSS, "script.js" for JavaScript
- Return complete, working code
- When modifying existing files, return only changed files with their complete updated content`;

function parseSwingFiles(response: string): SwingFile[] {
  const fileStart = response.indexOf("<<—[");
  if (fileStart === -1) {
    return [];
  }
  if (fileStart !== 0) {
    response = response.slice(fileStart);
  }

  return response
    .split("—>>")
    .map((e) => e.trim())
    .filter((e) => e.startsWith("<<—["))
    .map((e): SwingFile | null => {
      const separatorIndex = e.indexOf("]=\n");
      if (separatorIndex === -1) { return null; }
      const filename = e.slice(4, separatorIndex);
      const content = e.slice(separatorIndex + 3);
      return { filename, content };
    })
    .filter((f): f is SwingFile => f !== null && !!f.filename);
}

function createUserMessage(text: string): any {
  const messageFactory = (vscode as any).LanguageModelChatMessage;
  if (messageFactory?.User) {
    return messageFactory.User(text);
  }

  return { role: "user", content: text };
}

async function getCopilotModel(): Promise<any> {
  const models = await (vscode as any).lm.selectChatModels({
    vendor: "copilot",
  });
  if (models.length === 0) {
    throw new Error(
      "No GitHub Copilot language model is available. Make sure the GitHub Copilot extension is installed and you are signed in."
    );
  }
  return models[0];
}

async function sendRequest(
  messages: any[]
): Promise<SwingFile[]> {
  const model = await getCopilotModel();
  const cts = new vscode.CancellationTokenSource();
  try {
    const response = await model.sendRequest(messages, {}, cts.token);
    let fullResponse = "";
    for await (const chunk of response.text) {
      fullResponse += chunk;
    }
    return parseSwingFiles(fullResponse);
  } finally {
    cts.dispose();
  }
}

export async function generateSwingWithCopilot(prompt: string): Promise<SwingFile[]> {
  const messages = [
    createUserMessage(SYSTEM_PROMPT),
    createUserMessage(`REQUEST:\n${prompt}\n\nRESPONSE:`),
  ];
  return sendRequest(messages);
}

export async function refineSwingWithCopilot(
  prompt: string,
  currentFiles: SwingFile[]
): Promise<SwingFile[]> {
  const currentContent = currentFiles
    .map((f) => `<<—[${f.filename}]=\n${f.content ?? ""}\n—>>`)
    .join("\n\n");

  const messages = [
    createUserMessage(SYSTEM_PROMPT),
    createUserMessage(
      `Here are the current swing files:\n\n${currentContent}\n\nModify the swing based on the request below. Return only files that changed, with their complete updated content. No prose.\n\nREQUEST:\n${prompt}\n\nRESPONSE:`
    ),
  ];
  return sendRequest(messages);
}

export async function isCopilotAvailable(): Promise<boolean> {
  try {
    const models = await (vscode as any).lm.selectChatModels({
      vendor: "copilot",
    });
    return models.length > 0;
  } catch {
    return false;
  }
}
