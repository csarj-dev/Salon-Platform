import { describe, it, expect } from "vitest";
import {
  MAX_PHOTO_BYTES, buildPhotoKey, isSafeStorageKey, validatePhotoUpload,
} from "./photo-upload";

describe("validatePhotoUpload", () => {
  it("acepta jpeg, png y webp", () => {
    expect(validatePhotoUpload({ contentType: "image/jpeg", size: 1000 })).toEqual({ ok: true, extension: "jpg" });
    expect(validatePhotoUpload({ contentType: "image/png", size: 1000 })).toEqual({ ok: true, extension: "png" });
    expect(validatePhotoUpload({ contentType: "image/webp", size: 1000 })).toEqual({ ok: true, extension: "webp" });
  });

  it("rechaza otros tipos", () => {
    expect(validatePhotoUpload({ contentType: "image/gif", size: 1000 })).toEqual({ ok: false, reason: "type" });
    expect(validatePhotoUpload({ contentType: "application/pdf", size: 1000 })).toEqual({ ok: false, reason: "type" });
  });

  it("rechaza archivos vacíos o demasiado grandes", () => {
    expect(validatePhotoUpload({ contentType: "image/png", size: 0 })).toEqual({ ok: false, reason: "empty" });
    expect(validatePhotoUpload({ contentType: "image/png", size: MAX_PHOTO_BYTES + 1 })).toEqual({ ok: false, reason: "too_large" });
  });

  it("acepta justo el tamaño máximo", () => {
    expect(validatePhotoUpload({ contentType: "image/png", size: MAX_PHOTO_BYTES }).ok).toBe(true);
  });
});

describe("buildPhotoKey", () => {
  it("construye la clave con el salón y el ámbito", () => {
    expect(buildPhotoKey({ salonId: "the-room", scope: "staff", id: "abc-123", extension: "jpg" }))
      .toBe("salons/the-room/staff/abc-123.jpg");
  });

  it("rechaza valores que podrían salirse de su carpeta", () => {
    expect(() => buildPhotoKey({ salonId: "The Room", scope: "staff", id: "a", extension: "jpg" })).toThrow();
    expect(() => buildPhotoKey({ salonId: "the-room", scope: "x" as never, id: "a", extension: "jpg" })).toThrow();
    expect(() => buildPhotoKey({ salonId: "the-room", scope: "staff", id: "../a", extension: "jpg" })).toThrow();
    expect(() => buildPhotoKey({ salonId: "the-room", scope: "staff", id: "a", extension: "j/pg" })).toThrow();
  });
});

describe("isSafeStorageKey", () => {
  it("acepta las claves que genera buildPhotoKey", () => {
    const key = buildPhotoKey({ salonId: "the-room", scope: "hero", id: "abc", extension: "webp" });
    expect(isSafeStorageKey(key)).toBe(true);
  });

  it("rechaza rutas peligrosas", () => {
    for (const bad of ["../x.jpg", "/abs.jpg", "a//b.jpg", "a/b", "a/../b.jpg", "A/b.jpg"]) {
      expect(isSafeStorageKey(bad)).toBe(false);
    }
  });
});