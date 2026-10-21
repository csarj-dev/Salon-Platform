import { Mail } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { FaInstagram, FaWhatsapp } from "@/components/brand-icons";
import { instagramUrl } from "@/lib/showcase-links";

type Props = {
  name: string;
  whatsappHref: string | null;
  email?: string;
  instagram?: string;
};

const linkClass = "inline-flex min-h-11 items-center gap-2 underline underline-offset-4";
const iconClass = "size-4 shrink-0";

export async function SiteFooter({ name, whatsappHref, email, instagram }: Props) {
  const t = await getTranslations("Footer");
  const hasContact = whatsappHref || email || instagram;

  return (
    // pb-24: deja sitio para que el botón flotante de WhatsApp no tape el final
    <footer className="mt-12 border-t pb-24">
      <div className="mx-auto max-w-3xl px-6 py-8 text-sm">
        <p className="font-medium">{name}</p>
        {hasContact && (
          <div className="mt-2">
            <h2 className="sr-only">{t("contact")}</h2>
            <ul className="flex flex-wrap gap-x-6 text-muted-foreground">
              {whatsappHref && (
                <li>
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    <FaWhatsapp className={iconClass} aria-hidden="true" />
                    WhatsApp
                  </a>
                </li>
              )}
              {email && (
                <li>
                  <a href={`mailto:${email}`} className={linkClass}>
                    <Mail className={iconClass} aria-hidden="true" />
                    {email}
                  </a>
                </li>
              )}
              {instagram && (
                <li>
                  <a href={instagramUrl(instagram)} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    <FaInstagram className={iconClass} aria-hidden="true" />@
                    {instagram.replace(/^@/, "")}
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </footer>
  );
}