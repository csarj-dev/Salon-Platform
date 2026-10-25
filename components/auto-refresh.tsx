"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Props = {
  /** Cada cuánto se vuelve a pedir la página al servidor (ms) */
  everyMs?: number;
  /** Pasado este tiempo deja de consultar por su cuenta (ms) */
  stopAfterMs?: number;
};

// Mientras la cita espera el depósito, la página se actualiza sola: cada 20 s y, sobre todo,
// en cuanto la clienta vuelve a esta pestaña (por ejemplo, desde WhatsApp).
// Cuando la cita deja de estar pendiente, la página ya no pinta este componente y se detiene.
export function AutoRefresh({ everyMs = 20_000, stopAfterMs = 30 * 60_000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    const startedAt = performance.now();
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    // Al volver con "atrás", el móvil suele recuperar la página de su caché sin avisar con visibilitychange
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };

    const id = window.setInterval(() => {
      // Una pestaña olvidada no consulta al servidor para siempre; al volver a ella sí se actualiza
      if (performance.now() - startedAt > stopAfterMs) {
        window.clearInterval(id);
        return;
      }
      refresh();
    }, everyMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router, everyMs, stopAfterMs]);

  return null;
}