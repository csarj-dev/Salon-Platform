import { describe, expect, it } from "vitest";
import { bookableServices, type BookingCatalog } from "./booking-catalog";

const catalog: BookingCatalog = {
  locations: [{ id: 1, name: "Studio" }, { id: 2, name: "Micro" }],
  staff: [{ id: 10, name: "Lucía", koiboxAccount: "salon" }],
  services: [
    { id: 100, name: "Laminado", durationMin: 60, priceCents: 4500, depositCents: 1500, categoryId: 1 },
    { id: 101, name: "Diseño", durationMin: 30, priceCents: 2000, depositCents: 1500, categoryId: 1 },
    { id: 102, name: "Lifting", durationMin: 75, priceCents: 5500, depositCents: null, categoryId: 2 },
  ],
  offers: [
    { locationId: 1, serviceId: 100, priceCents: null },
    { locationId: 1, serviceId: 101, priceCents: 1800 },
    { locationId: 1, serviceId: 102, priceCents: null },
    { locationId: 2, serviceId: 100, priceCents: null },
  ],
  skills: [
    { staffId: 10, serviceId: 100 },
    { staffId: 10, serviceId: 101 },
  ],
};

describe("bookableServices", () => {
  it("los que ofrece el local y hace la profesional, con el precio del local", () => {
    expect(bookableServices(catalog, 10, 1).map((s) => [s.id, s.priceCents])).toEqual([
      [100, 4500],
      [101, 1800],
    ]);
  });

  it("en otro local, solo lo que se ofrece allí", () => {
    expect(bookableServices(catalog, 10, 2).map((s) => s.id)).toEqual([100]);
  });

  it("sin profesional o sin local, ninguno", () => {
    expect(bookableServices(catalog, null, 1)).toEqual([]);
    expect(bookableServices(catalog, 10, null)).toEqual([]);
  });
});