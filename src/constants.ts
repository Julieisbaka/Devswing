export const EXTENSION_NAME = "devswing";
export const LEGACY_COMMAND_PREFIX = "codeswing";
export const LEGACY_LIVE_SHARE_EXTENSION_IDS = [
	"codespaces-contrib.devswing",
];

export const INPUT_SCHEME = `${EXTENSION_NAME}-input`;

export const SWING_FILE = `${EXTENSION_NAME}.json`;
export const LEGACY_SWING_FILE = "codeswing.json";
export const SWING_FILES = [SWING_FILE, LEGACY_SWING_FILE];

export function getSwingManifestFile(files: string[]): string | undefined {
	return files.find((file) => SWING_FILES.includes(file));
}

export const URI_PATTERN = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
