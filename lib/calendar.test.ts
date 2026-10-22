import { describe, it, expect } from "vitest";
import {
  addMonths, firstWeekdayOf, isMonthKey, monthGrid, monthOfDay, referenceDateForWeekday,
  weekdayOrder,
} from "./calendar";

describe("isMonthKey y monthOfDay", () => {
  it("acepta meses válidos y rechaza el resto", () => {
    expect(isMonthKey("2026-11")).toBe(true);
    expect(isMonthKey("2026-12")).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-02", "", undefined]) {
      expect(isMonthKey(bad)).toBe(false);
    }
  });

  it("saca el mes de un día", () => {
    expect(monthOfDay("2026-11-02")).toBe("2026-11");
  });
});

describe("addMonths", () => {
  it("avanza y retrocede, cambiando de año", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-11", 14)).toBe("2028-01");
    expect(addMonths("2026-11", 0)).toBe("2026-11");
  });

  it("rechaza un mes mal escrito", () => {
    expect(() => addMonths("2026-13", 1)).toThrow(/Mes no válido/);
  });
});

describe("firstWeekdayOf", () => {
  it("español empieza en lunes e inglés en domingo", () => {
    expect(firstWeekdayOf("es")).toBe(1);
    expect(firstWeekdayOf("en")).toBe(7);
  });

  it("un idioma que no existe cae en lunes", () => {
    expect(firstWeekdayOf("")).toBe(1);
  });
});

describe("weekdayOrder", () => {
  it("ordena los días empezando por el elegido", () => {
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdayOrder(7)).toEqual([7, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(6)).toEqual([6, 7, 1, 2, 3, 4, 5]);
  });

  it("las fechas de referencia caen en su día de la semana", () => {
    expect(referenceDateForWeekday(1).getUTCDay()).toBe(1); // lunes
    expect(referenceDateForWeekday(7).getUTCDay()).toBe(0); // domingo
  });
});

describe("monthGrid", () => {
  it("noviembre de 2026 empieza en domingo: con semana en lunes, 6 huecos antes del día 1", () => {
    const grid = monthGrid("2026-11", 1);
    expect(grid[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(grid[1][0]).toBe("2026-11-02");
    expect(grid.at(-1)).toEqual(["2026-11-30", null, null, null, null, null, null]);
    expect(grid).toHaveLength(6);
  });

  it("con semana en domingo, noviembre de 2026 empieza en la primera celda", () => {
    const grid = monthGrid("2026-11", 7);
    expect(grid[0][0]).toBe("2026-11-01");
    expect(grid.at(-1)?.slice(0, 2)).toEqual(["2026-11-29", "2026-11-30"]);
  });

  it("todas las filas tienen 7 celdas y los días van en orden sin faltar ninguno", () => {
    for (const month of ["2026-02", "2028-02", "2026-10", "2026-12"]) {
      const grid = monthGrid(month, 1);
      expect(grid.every((row) => row.length === 7)).toBe(true);
      const days = grid.flat().filter((d): d is string => d !== null);
      expect(days[0]).toBe(`${month}-01`);
      expect(days).toEqual([...days].sort());
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("febrero tiene 28 días, y 29 en año bisiesto", () => {
    const count = (m: string) => monthGrid(m, 1).flat().filter(Boolean).length;
    expect(count("2026-02")).toBe(28);
    expect(count("2028-02")).toBe(29);
  });

  it("rechaza un mes mal escrito", () => {
    expect(() => monthGrid("noviembre", 1)).toThrow(/Mes no válido/);
  });
});