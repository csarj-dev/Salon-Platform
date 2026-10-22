import { describe, it, expect } from "vitest";
import { parseServiceArgs } from "./service-cli";

describe("parseServiceArgs", () => {
  it("lee el id, el slug y los textos por idioma", () => {
    expect(
      parseServiceArgs(["26", "--slug", "laminado-de-cejas", "--text-es", "Hola", "--text-en", "Hi"]),
    ).toEqual({ serviceId: 26, slug: "laminado-de-cejas", text: { es: "Hola", en: "Hi" } });
  });

  it("convierte \\n en saltos de línea", () => {
    const a = parseServiceArgs(["26", "--text-es", "Uno\\n\\nDos"]);
    expect(a.text.es).toBe("Uno\n\nDos");
  });

  it("acepta --slug auto", () => {
    expect(parseServiceArgs(["26", "--slug", "auto"]).slug).toBe("auto");
  });

  it("rechaza un slug con mayúsculas o espacios", () => {
    expect(() => parseServiceArgs(["26", "--slug", "Mi Servicio"])).toThrow(/Slug no válido/);
  });

  it("rechaza ids no válidos, nada que cambiar y opciones desconocidas", () => {
    expect(() => parseServiceArgs(["abc", "--slug", "auto"])).toThrow(/Id no válido/);
    expect(() => parseServiceArgs(["26"])).toThrow(/nada que cambiar/);
    expect(() => parseServiceArgs(["26", "--foo"])).toThrow(/Opción desconocida/);
    expect(() => parseServiceArgs(["26", "--text-es"])).toThrow(/Falta el texto/);
    expect(() => parseServiceArgs(["--slug", "auto"])).toThrow(/Uso:/);
  });
});