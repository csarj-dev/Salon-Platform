import { describe, it, expect } from "vitest";
import { joinPublicUrl } from "./public-url";

describe("joinPublicUrl", () => {
  it("une base y clave", () => {
    expect(joinPublicUrl("/uploads", "salons/a/b.jpg")).toBe("/uploads/salons/a/b.jpg");
    expect(joinPublicUrl("https://cdn.example.com", "k.jpg")).toBe("https://cdn.example.com/k.jpg");
  });

  it("no duplica la barra final de la base", () => {
    expect(joinPublicUrl("https://cdn.example.com/", "k.jpg")).toBe("https://cdn.example.com/k.jpg");
    expect(joinPublicUrl("https://cdn.example.com//", "k.jpg")).toBe("https://cdn.example.com/k.jpg");
  });
});