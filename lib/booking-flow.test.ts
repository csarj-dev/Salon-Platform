import { describe, it, expect } from "vitest";
import { parseFlowParams, flowQuery } from "./booking-flow";

describe("parseFlowParams", () => {
  it("devuelve todo vacío sin parámetros", () => {
    expect(parseFlowParams({})).toEqual({
      location: undefined,
      services: undefined,
      staff: undefined,
    });
  });

  it("lee ids numéricos y el valor 'any'", () => {
    expect(parseFlowParams({ location: "1", service: "7", staff: "any" })).toEqual({
      location: 1,
      services: [7],
      staff: "any",
    });
  });

  it("ignora valores inválidos", () => {
    const r = parseFlowParams({ location: "abc", service: "-3", staff: "0" });
    expect(r.location).toBeUndefined();
    expect(r.services).toBeUndefined();
    expect(r.staff).toBeUndefined();
  });

  it("si un parámetro viene repetido usa el primero", () => {
    expect(parseFlowParams({ location: ["2", "5"] }).location).toBe(2);
  });
});

describe("varios servicios en la URL", () => {
  it("lee la lista en su orden y quita repetidos", () => {
    expect(parseFlowParams({ service: "31,30" }).services).toEqual([31, 30]);
    expect(parseFlowParams({ service: "31,30,31" }).services).toEqual([31, 30]);
  });

  it("si alguno no vale, ignora la lista entera", () => {
    expect(parseFlowParams({ service: "31,x" }).services).toBeUndefined();
    expect(parseFlowParams({ service: "31,,30" }).services).toBeUndefined();
  });

  it("como mucho 6 servicios", () => {
    expect(parseFlowParams({ service: "1,2,3,4,5,6" }).services).toHaveLength(6);
    expect(parseFlowParams({ service: "1,2,3,4,5,6,7" }).services).toBeUndefined();
  });

  it("lee los marcados al volver a elegir", () => {
    expect(parseFlowParams({ picked: "31,30" }).picked).toEqual([31, 30]);
  });
});

describe("flowQuery", () => {
  it("omite lo que no está elegido", () => {
    expect(flowQuery({ location: 1, services: undefined })).toEqual({ location: "1" });
    expect(flowQuery({ location: 1, services: [] })).toEqual({ location: "1" });
  });

  it("incluye 'any' como texto y los servicios separados por comas", () => {
    expect(flowQuery({ location: 1, services: [2, 5], staff: "any" })).toEqual({
      location: "1",
      service: "2,5",
      staff: "any",
    });
  });
});

describe("día y hora en la URL", () => {
  it("lee el mes, el día y la hora", () => {
    const r = parseFlowParams({
      month: "2026-11",
      date: "2026-11-04",
      at: "2026-11-04T10:30:00.000Z",
    });
    expect(r).toMatchObject({
      month: "2026-11",
      date: "2026-11-04",
      at: "2026-11-04T10:30:00.000Z",
    });
  });

  it("ignora fechas con mal formato o que no existen", () => {
    const r = parseFlowParams({ month: "2026-13", date: "2026-02-31" });
    expect(r.month).toBeUndefined();
    expect(r.date).toBeUndefined();
    expect(parseFlowParams({ month: "noviembre" }).month).toBeUndefined();
    expect(parseFlowParams({ date: "02/11/2026" }).date).toBeUndefined();
  });

  it("ignora una hora que no es un instante UTC exacto", () => {
    expect(parseFlowParams({ at: "2026-11-04T10:30:00Z" }).at).toBeUndefined();
    expect(parseFlowParams({ at: "ayer" }).at).toBeUndefined();
    expect(parseFlowParams({ at: "2026-13-04T10:30:00.000Z" }).at).toBeUndefined();
  });

  it("flowQuery las devuelve tal cual, en el mismo formato", () => {
    const flow = {
      location: 1, services: [2, 3], staff: "any" as const,
      month: "2026-11", date: "2026-11-04", at: "2026-11-04T10:30:00.000Z",
    };
    expect(parseFlowParams(flowQuery(flow))).toEqual(flow);
  });
});