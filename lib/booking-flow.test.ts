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