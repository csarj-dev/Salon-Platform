import { describe, it, expect } from "vitest";
import { parseFlowParams, flowQuery } from "./booking-flow";

describe("parseFlowParams", () => {
  it("devuelve todo vacío sin parámetros", () => {
    expect(parseFlowParams({})).toEqual({
      location: undefined,
      service: undefined,
      staff: undefined,
    });
  });

  it("lee ids numéricos y el valor 'any'", () => {
    expect(parseFlowParams({ location: "1", service: "7", staff: "any" })).toEqual({
      location: 1,
      service: 7,
      staff: "any",
    });
  });

  it("ignora valores inválidos", () => {
    const r = parseFlowParams({ location: "abc", service: "-3", staff: "0" });
    expect(r.location).toBeUndefined();
    expect(r.service).toBeUndefined();
    expect(r.staff).toBeUndefined();
  });

  it("si un parámetro viene repetido usa el primero", () => {
    expect(parseFlowParams({ location: ["2", "5"] }).location).toBe(2);
  });
});

describe("flowQuery", () => {
  it("omite lo que no está elegido", () => {
    expect(flowQuery({ location: 1, service: undefined })).toEqual({ location: "1" });
  });

  it("incluye 'any' como texto", () => {
    expect(flowQuery({ location: 1, service: 2, staff: "any" })).toEqual({
      location: "1",
      service: "2",
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
      location: 1, service: 2, staff: "any" as const,
      month: "2026-11", date: "2026-11-04", at: "2026-11-04T10:30:00.000Z",
    };
    expect(parseFlowParams(flowQuery(flow))).toEqual(flow);
  });
});