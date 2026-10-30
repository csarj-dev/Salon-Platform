import { describe, expect, it } from "vitest";
import { parseLocationSyncArgs, planLocationSync } from "./location-sync";

const config = [
  { name: "The Room Studio", address: "Luján Pérez, 27, Adeje" },
  { name: "The Room Micropigmentacion", address: "Plaza César Manrique, 10, Local 3, Adeje" },
];

describe("planLocationSync", () => {
  it("empareja por orden de id y cambia nombre, dirección y slug", () => {
    expect(
      planLocationSync(
        [
          { id: 2, name: "The Room Sur", address: "Dirección de ejemplo 2", slug: "the-room-sur" },
          { id: 1, name: "The Room Centro", address: "Dirección de ejemplo 1", slug: "the-room-centro" },
        ],
        config,
      ),
    ).toEqual([
      {
        id: 1,
        name: { from: "The Room Centro", to: "The Room Studio" },
        address: { from: "Dirección de ejemplo 1", to: "Luján Pérez, 27, Adeje" },
        slug: { from: "the-room-centro", to: "the-room-studio" },
      },
      {
        id: 2,
        name: { from: "The Room Sur", to: "The Room Micropigmentacion" },
        address: { from: "Dirección de ejemplo 2", to: "Plaza César Manrique, 10, Local 3, Adeje" },
        slug: { from: "the-room-sur", to: "the-room-micropigmentacion" },
      },
    ]);
  });

  it("solo lo que cambia; sin dirección en el config se deja la que hay", () => {
    expect(
      planLocationSync(
        [
          { id: 1, name: "The Room Studio", address: "Luján Pérez, 27, Adeje", slug: "the-room-studio" },
          { id: 2, name: "The Room Micropigmentacion", address: "Otra", slug: "the-room-micro" },
        ],
        [config[0], { name: config[1].name }],
      ),
    ).toEqual([{ id: 2, slug: { from: "the-room-micro", to: "the-room-micropigmentacion" } }]);
  });

  it("si ya coincide todo, nada", () => {
    expect(
      planLocationSync(
        [
          { id: 1, name: config[0].name, address: config[0].address, slug: "the-room-studio" },
          { id: 2, name: config[1].name, address: config[1].address, slug: "the-room-micropigmentacion" },
        ],
        config,
      ),
    ).toEqual([]);
  });

  it("no empareja si no hay los mismos locales", () => {
    expect(() => planLocationSync([{ id: 1, name: "A", address: null, slug: "a" }], config)).toThrow(/no se pueden emparejar/);
    expect(() => planLocationSync([], [])).toThrow(/initialLocations/);
  });
});

describe("parseLocationSyncArgs", () => {
  it("sin opciones enseña el plan, --apply aplica y <id> <slug> pone un slug", () => {
    expect(parseLocationSyncArgs([])).toEqual({ kind: "plan" });
    expect(parseLocationSyncArgs(["--apply"])).toEqual({ kind: "apply" });
    expect(parseLocationSyncArgs(["2", "the-room-studio"])).toEqual({ kind: "set-slug", id: 2, slug: "the-room-studio" });
  });

  it("rechaza ids, slugs u opciones no válidos", () => {
    expect(() => parseLocationSyncArgs(["x", "a"])).toThrow(/Id no válido/);
    expect(() => parseLocationSyncArgs(["2", "The Room"])).toThrow(/Slug no válido/);
    expect(() => parseLocationSyncArgs(["--foo"])).toThrow(/Uso:/);
  });
});