import * as vsls from "vsls";
import { LEGACY_LIVE_SHARE_EXTENSION_IDS } from "../constants";

async function getLiveShareApi(extensionId: string) {
  const extensionIds = [
    extensionId,
    ...LEGACY_LIVE_SHARE_EXTENSION_IDS,
  ].filter((id, index, ids) => ids.indexOf(id) === index);

  for (const id of extensionIds) {
    const api = await vsls.getApi(id);
    if (api) {
      return api;
    }
  }
}

export async function registerLiveShareModule(extensionId: string) {
  const vslsApi = await getLiveShareApi(extensionId);
  if (!vslsApi) {
    return;
  }

  vslsApi.onDidChangeSession((e) => {
    if (e.session.id) {
      initializeService(vslsApi);
    }
  });

  if (vslsApi.session.id) {
    initializeService(vslsApi);
  }
}

async function initializeService(vslsApi: vsls.LiveShare) {
  let { initializeService } =
    vslsApi.session.role === vsls.Role.Host
      ? require("./hostService")
      : require("./guestService");

  await initializeService(vslsApi);
}
