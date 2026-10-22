"use server";

import { DateTime } from "luxon";
import { hasLocale } from "next-intl";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getAvailabilityForService } from "@/lib/availability-service";
import { parseFlowParams } from "@/lib/booking-flow";
import { clientFormSchema } from "@/lib/booking-schema";
import { createAppointment, toBookingOptions } from "@/lib/booking";
import { loadSalonConfig, toAvailabilityOptions } from "@/lib/salon-config";

export type BookingFormState = {
  error?: "invalid" | "slot_taken" | "slot_unavailable" | "server";
  // Campos con error, para marcarlos
  fields?: Partial<Record<"name" | "phone" | "email" | "consent", true>>;
  // Lo que escribió la clienta, para no obligarla a repetirlo
  values?: { name: string; phone: string; email: string };
};

const text = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === "string" ? v : "";
};

// Recibe el formulario del paso 5. Nada de lo que llega se da por bueno:
// la hora se vuelve a comprobar contra la disponibilidad real en createAppointment.
export async function submitBooking(
  _previous: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const locale = text(formData, "locale");
  if (!hasLocale(routing.locales, locale)) return { error: "server" };

  const values = {
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
  };

  // 1. Qué se reserva (mismo formato que la URL, así se valida con las mismas reglas)
  const flow = parseFlowParams({
    location: text(formData, "location"),
    service: text(formData, "service"),
    staff: text(formData, "staff"),
    at: text(formData, "at"),
  });
  if (!flow.location || !flow.service || !flow.staff || !flow.at) {
    return { error: "slot_unavailable", values };
  }

  // 2. Datos de la clienta
  const consent = formData.get("consent") === "on";
  const client = clientFormSchema.safeParse(values);
  if (!client.success || !consent) {
    const fields: NonNullable<BookingFormState["fields"]> = {};
    if (!client.success) {
      for (const issue of client.error.issues) {
        const key = issue.path[0];
        if (key === "name" || key === "phone" || key === "email") fields[key] = true;
      }
    }
    if (!consent) fields.consent = true;
    return { error: "invalid", fields, values };
  }

  let publicToken: string;
  try {
    const config = await loadSalonConfig();
    const bookingOptions = toBookingOptions(config);
    const now = new Date();
    const startsAt = new Date(flow.at);

    // 3. "Cualquiera": se asigna la primera profesional libre a esa hora
    let staffId: number;
    if (flow.staff === "any") {
      const day = DateTime.fromJSDate(startsAt, { zone: config.timezone }).toFormat("yyyy-MM-dd");
      const availability = await getAvailabilityForService(
        flow.location,
        flow.service,
        day,
        toAvailabilityOptions(config),
        now,
      );
      const slot = availability.any.find((s) => s.startsAt.getTime() === startsAt.getTime());
      if (!slot) return { error: "slot_unavailable", values };
      staffId = slot.staffIds[0];
    } else {
      staffId = flow.staff;
    }

    // 4. Crear la cita (comprueba otra vez el hueco, y la base de datos impide solapes)
    const result = await createAppointment(
      {
        locationId: flow.location,
        serviceId: flow.service,
        staffId,
        startsAt,
        source: "web",
        client: client.data,
        consent,
      },
      bookingOptions,
      now,
    );

    if (!result.ok) {
      if (result.reason === "slot_taken") return { error: "slot_taken", values };
      if (result.reason === "invalid_input") return { error: "invalid", values };
      return { error: "slot_unavailable", values };
    }
    publicToken = result.publicToken;
  } catch (error) {
    console.error("No se pudo crear la reserva", error);
    return { error: "server", values };
  }

  // redirect lanza una excepción propia de Next: tiene que ir fuera del try/catch
  redirect({ href: `/booking/confirmed/${publicToken}`, locale });

  // Nunca se llega aquí (redirect no devuelve), pero TypeScript no lo sabe
  // porque `redirect` sale de createNavigation y no está declarada como `never` de forma explícita
  return {};
}
