import { Clock, MapPin, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { Card, CardContent } from "@/components/ui/card";
import { Photo } from "@/components/photo";
import type { PhotoView } from "@/lib/photos";
import type { HoursLine } from "@/lib/opening-hours";

type Props = {
  name: string;
  address: string | null;
  phone: string | null;
  mapsUrl: string | null;
  hours: HoursLine[]; // vacío = no mostrar horario
  whatsappHref: string | null;
  /** Foto del local; sin foto, la tarjeta no reserva hueco */
  photo?: PhotoView | null;
  /** Enlace "Ver local"; sin enlace, no se muestra el botón */
  detailsHref?: string;
  /** En la página del propio local el título ya está en el h1 */
  hideHeading?: boolean;
};

export async function LocationCard({
  name, address, phone, mapsUrl, hours, whatsappHref, photo, detailsHref, hideHeading,
}: Props) {
  const t = await getTranslations("Showcase");

  return (
    <Card>
      <CardContent className="space-y-4">
        {photo && (
          <Photo
            photo={photo}
            ratio="16 / 10"
            sizes="(min-width: 768px) 50vw, 100vw"
            className="rounded-lg"
          />
        )}

        {!hideHeading && <h3 className="text-lg font-medium">{name}</h3>}

        {address && (
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{address}</span>
          </p>
        )}

        {hours.length > 0 && (
          <div className="flex items-start gap-2 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="sr-only">{t("hours")}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {hours.map((h) => (
                  <div key={h.days} className="contents">
                    <dt className="font-medium">{h.days}</dt>
                    <dd className={h.hours ? "" : "text-muted-foreground"}>
                      {h.hours ?? t("closed")}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

        {phone && (
          <p className="flex items-center gap-2 text-sm">
            <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-4">
              {t("call")} {phone}
            </a>
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {detailsHref && (
            <Link
              href={detailsHref}
              className="inline-flex h-11 items-center rounded-lg border px-5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("viewLocation")}
            </Link>
          )}
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-lg border px-5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("directions")}
            </a>
          )}
          {whatsappHref && <WhatsAppButton href={whatsappHref}>{t("whatsappChat")}</WhatsAppButton>}
        </div>
      </CardContent>
    </Card>
  );
}