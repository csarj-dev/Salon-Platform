import { notFound } from "next/navigation";
import { io } from "next/cache";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { getConfirmation } from "@/lib/appointment-view";
import { formatDateTime, formatPrice } from "@/lib/format";
import { loadSalonConfig } from "@/lib/salon-config";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ locale: string; token: string }> };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

// Paso 6: la cita ya está creada. Se llega con el enlace secreto de la cita.
export async function ConfirmationContent({ params }: Props) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const [config, t] = await Promise.all([
    loadSalonConfig(),
    getTranslations({ locale, namespace: "Confirmation" }),
  ]);
  if (!config.booking.channels.includes("online")) notFound();

    // La hora actual cambia en cada visita: se excluye del prerenderizado con io() antes de leerla
  await io();
  const view = await getConfirmation(token, locale, config.defaultLocale, new Date());
  if (!view) notFound();

  const zone = config.timezone;
  const when = formatDateTime(view.startsAt, locale, zone);
  const phone = config.contact.whatsapp;
  const whatsapp = (message: string) => (phone ? buildWhatsAppLink(phone, message) : null);

  const title = {
    booked: t("titleBooked"),
    pending_deposit: t("titlePending"),
    expired: t("titleExpired"),
    cancelled: t("titleCancelled"),
    completed: t("titleOther"),
    no_show: t("titleOther"),
  }[view.status];

  const deposit = view.depositCents !== null ? formatPrice(view.depositCents, locale, config.currency) : null;
  const { instructions, policy } = config.booking.deposit;
  const proofHref = whatsapp(t("proofMessage", { id: view.id, service: view.serviceName, when }));
  const contactHref = whatsapp(t("contactMessage", { id: view.id, service: view.serviceName, when }));

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("reference", { id: view.id })}</p>

      <dl className="mt-6 divide-y rounded-lg border px-4">
        <Row label={t("service")}>{view.serviceName}</Row>
        <Row label={t("when")}>{when}</Row>
        <Row label={t("where")}>
          {view.locationName}
          {view.locationAddress && (
            <span className="block text-sm font-normal text-muted-foreground">
              {view.locationAddress}
            </span>
          )}
        </Row>
        <Row label={t("with")}>{view.staffName}</Row>
        <Row label={t("price")}>{formatPrice(view.priceCents, locale, config.currency)}</Row>
      </dl>

      {view.status === "pending_deposit" && deposit && view.depositDueAt && (
        <section className="mt-6 space-y-3 rounded-lg border bg-muted/50 p-4">
          <h2 className="font-medium">{t("depositTitle", { amount: deposit })}</h2>
          <p className="text-sm">
            {t("depositDue", { date: formatDateTime(view.depositDueAt, locale, zone) })}
          </p>
          <div>
            <h3 className="text-sm font-medium">{t("howToPay")}</h3>
            <p className="mt-1 whitespace-pre-line text-sm">
              {instructions?.[locale] ?? instructions?.[config.defaultLocale] ?? t("payNoInstructions")}
            </p>
          </div>
          {policy && (
            <div>
              <h3 className="text-sm font-medium">{t("policy")}</h3>
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                {policy[locale] ?? policy[config.defaultLocale]}
              </p>
            </div>
          )}
          {proofHref && <WhatsAppButton href={proofHref}>{t("sendProof")}</WhatsAppButton>}
        </section>
      )}

      {view.status === "booked" && (
        <p className="mt-6 text-sm text-muted-foreground">
          {t("bookedHelp", { hours: config.booking.cancellationNoticeHours })}
        </p>
      )}
      {view.status === "expired" && (
        <p className="mt-6 text-sm text-muted-foreground">{t("expiredHelp")}</p>
      )}
      {view.status === "cancelled" && (
        <p className="mt-6 text-sm text-muted-foreground">{t("cancelledHelp")}</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(view.status === "expired" || view.status === "cancelled") && (
          <Link href="/booking" className={cn(buttonVariants({ size: "lg" }), "h-11 px-5")}>
            {t("bookAgain")}
          </Link>
        )}
        {view.status === "booked" && contactHref && (
          <WhatsAppButton href={contactHref} variant="outline">
            {t("contact")}
          </WhatsAppButton>
        )}
        <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-5")}>
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
