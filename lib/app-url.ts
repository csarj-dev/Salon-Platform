// Dirección pública de la web (sin barra final). Se usa en los enlaces de los correos.
// En producción: APP_URL=https://tu-dominio. En local cae a http://localhost:3000.
export function appUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.APP_URL?.trim();
  return (raw && raw.length > 0 ? raw : "http://localhost:3000").replace(/\/+$/, "");
}