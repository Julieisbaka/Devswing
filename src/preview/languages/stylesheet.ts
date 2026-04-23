import * as path from "path";
import { TextDocument } from "vscode";
import { store } from "../../store";
import { byteArrayToString } from "../../utils";

export const STYLESHEET_BASE_NAME = "style";

const STYLESHEET_LANGUAGE = {
  css: ".css",
  less: ".less",
  sass: ".sass",
  scss: ".scss",
};

export const STYLESHEET_EXTENSIONS = [
  STYLESHEET_LANGUAGE.css,
  STYLESHEET_LANGUAGE.less,
  STYLESHEET_LANGUAGE.sass,
  STYLESHEET_LANGUAGE.scss,
];

export async function getStylesheetContent(
  document: TextDocument
): Promise<string | null> {
  const content = document.getText();
  if (content.trim() === "") {
    return content;
  }

  const extension = path.extname(document.uri.path).toLocaleLowerCase();

  try {
    switch (extension) {
      case STYLESHEET_LANGUAGE.scss:
      case STYLESHEET_LANGUAGE.sass: {
        const sass = require("@abstractions/sass");
        const css = await sass.compile(
          content,
          extension === STYLESHEET_LANGUAGE.sass,
          store.activeSwing!.currentUri
        );

        return byteArrayToString(css);
      }
      case STYLESHEET_LANGUAGE.less: {
        const less = require("less").default;
        const output = await less.render(content);
        return output.css;
      }
      default:
        return content;
    }
  } catch {
    return null;
  }
}
