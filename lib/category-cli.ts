// db/category-color.ts: ver las categorías y poner o quitar el color de su franja en la agenda.
// Lógica pura (leer lo que se escribió); el comando hace la base de datos.

export const CATEGORY_COLOR_USAGE = [
  "Uso:",
  '  npx tsx db/category-color.ts                     ver las categorías y su color',
  '  npx tsx db/category-color.ts <id|nombre> "#b0607c"  poner un color',
  "  npx tsx db/category-color.ts <id|nombre> --none     quitarlo (sin franja)",
].join("\n");

export type CategoryColorCommand =
  | { command: "list" }
  // `category`: un id (número) o el nombre interno de la categoría
  | { command: "set"; category: number | string; color: string | null };

// "#B0607C", "b0607c" o "#b06" -> "#b0607c". Lanza un error si no es un color hexadecimal.
export function normalizeHexColor(text: string): string {
  const raw = text.trim().replace(/^#/, "").toLowerCase();
  const full = /^[0-9a-f]{3}$/.test(raw) ? [...raw].map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/.test(full)) {
    throw new Error(`Color no válido: "${text}" (ejemplo: "#b0607c")`);
  }
  return `#${full}`;
}

export function parseCategoryColorArgs(argv: string[]): CategoryColorCommand {
  if (argv.length === 0) return { command: "list" };
  if (argv.length !== 2) throw new Error(CATEGORY_COLOR_USAGE);
  const [who, value] = argv;
  const category = /^\d+$/.test(who) ? Number(who) : who.trim();
  if (category === "" || category === 0) throw new Error(CATEGORY_COLOR_USAGE);
  if (value === "--none") return { command: "set", category, color: null };
  if (value.startsWith("--")) throw new Error(`Opción desconocida: ${value}\n${CATEGORY_COLOR_USAGE}`);
  return { command: "set", category, color: normalizeHexColor(value) };
}