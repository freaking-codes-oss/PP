declare module 'espeak-ng' {
  interface ESpeakFactoryOptions {
    noExitRuntime?: boolean;
    print?: (...args: unknown[]) => void;
    printErr?: (...args: unknown[]) => void;
    preRun?: Array<(mod: any) => void>;
    arguments?: string[];
  }
  /** Emscripten MODULARIZE factory for the eSpeak-NG WASM build. */
  const factory: (opts?: ESpeakFactoryOptions) => Promise<any>;
  export default factory;
}
