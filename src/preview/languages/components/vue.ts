import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";

const COMPONENT_NAME = "index.vue";

const APP_INIT = `
createApp(__vue_component__).mount("#app");
`;

const VUE_ESM_URL = "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js";

export function compileComponent(content: string): [string, string, [string, string][]] {
  const { descriptor, errors } = parse(content, { filename: COMPONENT_NAME });
  if (errors.length > 0) {
    throw new Error(errors[0].message);
  }

  const id = "devswing-vue";

  const scriptResult = compileScript(descriptor, { id });

  const templateResult = compileTemplate({
    source: descriptor.template?.content ?? "",
    filename: COMPONENT_NAME,
    id,
    compilerOptions: {
      bindingMetadata: scriptResult.bindings,
    },
  });

  const componentCode = `
${scriptResult.content}
${templateResult.code}
const __vue_component__ = _sfc_main;
__vue_component__.render = render;
`;

  return [componentCode, APP_INIT, [["{ createApp }", VUE_ESM_URL]]];
}
