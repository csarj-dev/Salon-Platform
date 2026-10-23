import { describe, expect, it } from "vitest";
import { resendKind } from "./resend-kind";

describe("resendKind", () => {
  it("confirmada → confirmación; cancelada → cancelación", () => {
    expect(resendKind("booked")).toBe("confirmation");
    expect(resendKind("cancelled")).toBe("cancellation");
  });

  it("el resto de estados no se reenvía", () => {
    for (const s of ["pending_deposit", "expired", "completed", "no_show"]) {
      expect(resendKind(s)).toBeNull();
    }
  });
});