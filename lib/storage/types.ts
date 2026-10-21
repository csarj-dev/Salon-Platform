export type Storage = {
  /** URL desde la que el navegador carga la foto */
  publicUrl(key: string): string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Solo R2: URL firmada para que el navegador suba directo, sin pasar por el servidor */
  createUploadUrl?(key: string, contentType: string): Promise<string>;
};