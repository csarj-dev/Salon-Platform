"use client";

import { useEffect } from "react";

// Al llegar a la confirmación recién reservada (?whatsapp=1), salta una sola vez a WhatsApp
// para pedir el enlace de pago. Antes quita el ?whatsapp=1 de la dirección: así, al volver
// del chat con "atrás", la clienta se queda en la confirmación (que se refresca sola) sin volver a saltar.
export function OpenWhatsAppOnce({ href }: { href: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("whatsapp") !== "1") return;
    url.searchParams.delete("whatsapp");
    window.history.replaceState(window.history.state, "", url);
    window.location.assign(href);
  }, [href]);

  return null;
}