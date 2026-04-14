declare module 'draco3dgltf' {
  export interface DracoModule {
    [key: string]: unknown;
  }

  export function createEncoderModule(options?: Record<string, unknown>): Promise<DracoModule>;
  export function createDecoderModule(options?: Record<string, unknown>): Promise<DracoModule>;

  const draco3d: {
    createEncoderModule: typeof createEncoderModule;
    createDecoderModule: typeof createDecoderModule;
  };

  export default draco3d;
}
