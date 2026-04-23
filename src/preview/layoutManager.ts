import { commands, TextDocument, ViewColumn, window } from "vscode";
import * as config from "../config";

enum EditorLayoutOrientation {
  horizontal = 0,
  vertical = 1,
}

const EDITOR_LAYOUTS = {
  splitOne: {
    orientation: EditorLayoutOrientation.horizontal,
    groups: [{}, {}],
  },
  splitTwo: {
    orientation: EditorLayoutOrientation.horizontal,
    groups: [
      {
        orientation: EditorLayoutOrientation.vertical,
        groups: [{}, {}],
        size: 0.5,
      },
      { groups: [{}], size: 0.5 },
    ],
  },
  splitThree: {
    orientation: EditorLayoutOrientation.horizontal,
    groups: [
      {
        orientation: EditorLayoutOrientation.vertical,
        groups: [{}, {}, {}],
        size: 0.5,
      },
      { groups: [{}], size: 0.5 },
    ],
  },
  grid: {
    orientation: EditorLayoutOrientation.horizontal,
    groups: [
      {
        orientation: EditorLayoutOrientation.vertical,
        groups: [{}, {}],
        size: 0.5,
      },
      {
        orientation: EditorLayoutOrientation.vertical,
        groups: [{}, {}],
        size: 0.5,
      },
    ],
  },
};

export enum SwingLayout {
  grid = "grid",
  preview = "preview",
  splitBottom = "splitBottom",
  splitLeft = "splitLeft",
  splitLeftTabbed = "splitLeftTabbed",
  splitRight = "splitRight",
  splitRightTabbed = "splitRightTabbed",
  splitTop = "splitTop",
}

export async function createLayoutManager(
  includedFiles: number,
  layout?: string
) {
  if (!layout) {
    layout = await config.get("layout");
  }

  let currentViewColumn = ViewColumn.One;
  let previewViewColumn = includedFiles + 1;

  let editorLayout: any;
  if (includedFiles === 3) {
    editorLayout =
      layout === SwingLayout.grid
        ? EDITOR_LAYOUTS.grid
        : EDITOR_LAYOUTS.splitThree;
  } else if (includedFiles === 2) {
    editorLayout = EDITOR_LAYOUTS.splitTwo;
  } else {
    editorLayout = EDITOR_LAYOUTS.splitOne;
  }

  if (layout === SwingLayout.splitRight) {
    editorLayout = {
      ...editorLayout,
      groups: [...editorLayout.groups].reverse(),
    };

    currentViewColumn = ViewColumn.Two;
    previewViewColumn = ViewColumn.One;
  } else if (layout === SwingLayout.splitTop) {
    editorLayout = {
      ...editorLayout,
      orientation: EditorLayoutOrientation.vertical,
    };
  } else if (layout === SwingLayout.splitBottom) {
    editorLayout = {
      orientation: EditorLayoutOrientation.vertical,
      groups: [...editorLayout.groups].reverse(),
    };

    currentViewColumn = ViewColumn.Two;
    previewViewColumn = ViewColumn.One;
  } else if (layout === SwingLayout.splitLeftTabbed) {
    editorLayout = EDITOR_LAYOUTS.splitOne;
    previewViewColumn = ViewColumn.Two;
  } else if (layout === SwingLayout.splitRightTabbed) {
    editorLayout = EDITOR_LAYOUTS.splitOne;

    currentViewColumn = ViewColumn.Two;
    previewViewColumn = ViewColumn.One;
  }

  await commands.executeCommand("workbench.action.closeAllEditors");
  await commands.executeCommand("workbench.action.closePanel");
  await commands.executeCommand("workbench.action.closeSidebar");

  // The preview layout mode only shows a single file,
  // so there's no need to set a custom editor layout for it.
  if (includedFiles > 0 && layout !== SwingLayout.preview) {
    await commands.executeCommand("vscode.setEditorLayout", editorLayout);
  }

  return {
    previewViewColumn,
    showDocument: async function(
      document: TextDocument,
      preserveFocus: boolean = true
    ) {
      if (layout === SwingLayout.preview) {
        return;
      }

      const editor = window.showTextDocument(document, {
        preview: false,
        viewColumn: currentViewColumn,
        preserveFocus,
      });

      if (
        layout !== SwingLayout.splitLeftTabbed &&
        layout !== SwingLayout.splitRightTabbed
      ) {
        currentViewColumn++;
      }

      return editor;
    },
  };
}
