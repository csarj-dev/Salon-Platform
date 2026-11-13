import { Suspense } from "react";
import { io } from "next/cache";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader, StatusPill, Surface, UserAvatar } from "@/components/admin/panel-ui";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { UserDialog } from "@/components/admin/user-dialog";
import { calendarDayDiff, formatShortDate, formatTime } from "@/lib/format";
import { parseRoles, permissionMatrix, ROLES } from "@/lib/permissions";
import { loadSalonConfig } from "@/lib/salon-config";
import { requireStaff } from "@/lib/session";
import { listPanelUsers } from "@/lib/user-db";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ locale: string }> };

export default async function UsersPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.users" });

  // La cabecera va dentro del contenido: «Nuevo usuario» solo debe salir tras
  // comprobar que quien mira es administrador
  return (
    <section className="space-y-6">
      <Suspense
        fallback={
          <>
            <PageHeader title={t("title")} description={t("intro")} />
            <PanelSkeleton />
          </>
        }
      >
        <UsersContent locale={locale} />
      </Suspense>
    </section>
  );
}

const th = "border-b px-4 py-3 font-medium";
// En el móvil cada fila es una tarjeta: nombre, rol y estado en una línea, último acceso y Editar
const cell = "block px-4 md:table-cell md:border-b md:py-3 md:align-middle";
const inlineCell = "inline-block pt-2 pl-4 md:table-cell md:border-b md:px-4 md:py-3 md:align-middle";

async function UsersContent({ locale }: { locale: string }) {
  // Solo el administrador gestiona usuarios (si no, 404)
  const { user: actor } = await requireStaff(locale, "users.manage");
  const [config, t, tRoles, users] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Admin.users" }),
    getTranslations({ locale, namespace: "Admin.roles" }),
    listPanelUsers(),
  ]);
  // «Hoy» y «ayer» dependen de la hora: fuera del prerenderizado
  await io();
  const now = new Date();
  const zone = config.timezone;
  const matrix = permissionMatrix();

  const lastSeen = (d: Date | null) => {
    if (!d) return t("seen.never");
    const days = calendarDayDiff(d, now, zone);
    const time = formatTime(d, locale, zone);
    if (days === 0) return t("seen.today", { time });
    if (days === 1) return t("seen.yesterday", { time });
    return formatShortDate(d, locale, zone, now);
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} action={<UserDialog mode="create" />} />

      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{t("title")}</caption>
          <thead className="hidden md:table-header-group">
            <tr className="text-left text-xs tracking-[0.06em] text-muted-foreground uppercase">
              <th scope="col" className={th}>{t("table.user")}</th>
              <th scope="col" className={th}>{t("table.role")}</th>
              <th scope="col" className={th}>{t("table.state")}</th>
              <th scope="col" className={th}>{t("table.lastSeen")}</th>
              <th scope="col" className={th}>
                <span className="sr-only">{t("table.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const role = parseRoles(u.role)[0] ?? "reception";
              const isSelf = u.id === actor.id;
              return (
                <tr
                  key={u.id}
                  className={cn(
                    "block border-b py-3 last:border-b-0 md:table-row md:py-0 md:[&:last-child>td]:border-b-0",
                    u.banned && "opacity-70",
                  )}
                >
                  <td className={cell}>
                    <span className="flex items-center gap-3">
                      <UserAvatar name={u.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {u.name}
                          {isSelf && <span className="font-normal text-muted-foreground"> {t("you")}</span>}
                        </span>
                        <span className="block truncate text-muted-foreground">{u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className={inlineCell}>
                    <StatusPill tone="neutral">{tRoles(role)}</StatusPill>
                  </td>
                  <td className={inlineCell}>
                    <StatusPill tone={u.banned ? "neutral" : "ok"}>
                      {u.banned ? t("inactive") : t("active")}
                    </StatusPill>
                  </td>
                  <td className={cn(cell, "pt-2 text-muted-foreground md:text-foreground")}>
                    <span className="md:hidden">{t("table.lastSeen")}: </span>
                    {lastSeen(u.lastSeenAt)}
                  </td>
                  <td className={cn(cell, "md:text-right")}>
                    <UserDialog
                      mode="edit"
                      user={{
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        role,
                        banned: u.banned,
                        isSelf,
                        since: t("since", { date: formatShortDate(u.createdAt, locale, zone, now) }),
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sale de PERMISSIONS: lo que dice esta tabla es lo que comprueba el código */}
      <Surface className="space-y-3 p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("permsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("permsIntro")}</p>
        </div>
        {/* En el móvil, una lista: cada permiso con los roles que lo tienen */}
        <ul className="divide-y md:hidden">
          {matrix.map((row) => (
            <li key={row.permission} className="space-y-1.5 py-3">
              <p className="text-sm">
                {t(`perms.${row.permission}.label`)}
                <span className="block text-xs text-muted-foreground">{t(`perms.${row.permission}.hint`)}</span>
              </p>
              <p className="flex flex-wrap gap-1.5">
                {ROLES.filter((r) => row.allowed[r]).map((r) => (
                  <StatusPill key={r} tone="ok">
                    {tRoles(r)}
                  </StatusPill>
                ))}
              </p>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("permsTitle")}</caption>
            <thead>
              <tr className="text-xs tracking-[0.06em] text-muted-foreground uppercase">
                <th scope="col" className="border-b px-3 py-2.5 text-left font-medium">
                  <span className="sr-only">{t("permission")}</span>
                </th>
                {ROLES.map((r) => (
                  <th key={r} scope="col" className="w-32 border-b px-3 py-2.5 text-center font-medium">
                    {tRoles(r)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.permission} className="[&:last-child>*]:border-b-0">
                  <th scope="row" className="border-b px-3 py-3 text-left font-normal">
                    {t(`perms.${row.permission}.label`)}
                    <span className="block text-xs text-muted-foreground">{t(`perms.${row.permission}.hint`)}</span>
                  </th>
                  {ROLES.map((r) => (
                    <td key={r} className="border-b px-3 py-3 text-center">
                      {row.allowed[r] ? (
                        <StatusPill tone="ok">{t("yes")}</StatusPill>
                      ) : (
                        <span className="text-muted-foreground">
                          <span aria-hidden>—</span>
                          <span className="sr-only">{t("no")}</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Surface>
    </>
  );
}