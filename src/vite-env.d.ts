/// <reference types="vite/client" />

declare module '@wasmer/sdk/wasm?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly VITE_RIZIN_RELEASES_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
