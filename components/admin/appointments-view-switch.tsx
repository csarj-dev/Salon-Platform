import { getTranslations } from "next-intl/server";
import { SegmentLinks } from "./panel-ui";

// «Agenda | Lista»: dos maneras de mirar las mismas citas. La Agenda es lo que se ve al entrar.
export async function AppointmentsViewSwitch({ locale, active }: { locale: string; active: "agenda" | "list" }) {
  const t = await getTranslations({ locale, namespace: "Admin.appointments.view" });
  return (
    <SegmentLinks
      label={t("label")}
      items={[
        { href: "/admin/appointments", label: t("agenda"), active: active === "agenda" },
        { href: "/admin/appointments/list", label: t("list"), active: active === "list" },
      ]}
    />
  );
}