import * as path from "path";
import { SWING_FILES } from "./constants";
import { getCandidateMarkupFilenames } from "./preview/languages/markup";

export const api = {
  isSwing(files: string[]) {
    return (
      files.includes(".block") ||
      files.some((file) => SWING_FILES.includes(file)) ||
      files.some((file) => getCandidateMarkupFilenames().includes(file)) ||
      files.includes("scripts") ||
      (files.includes("script.js") &&
        files.some((file) => path.extname(file) === ".markdown"))
    );
  },
};
