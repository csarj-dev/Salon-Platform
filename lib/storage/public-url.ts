// Une la base y la clave sin dobles barras
export function joinPublicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key}`;
}