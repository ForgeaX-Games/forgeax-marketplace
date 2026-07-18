declare module 'draco3dgltf' {
  interface DracoModule {
    // Opaque WASM module handle consumed by @gltf-transform/extensions.
  }
  interface Draco3dGltf {
    createDecoderModule(): Promise<DracoModule>;
    createEncoderModule(): Promise<DracoModule>;
  }
  const draco3d: Draco3dGltf;
  export default draco3d;
}
