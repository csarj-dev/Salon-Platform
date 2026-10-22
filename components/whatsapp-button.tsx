import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FaWhatsapp } from "@/components/brand-icons";

type ButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "default" | "outline" | "ghost";
  className?: string;
};

const iconClass = "size-4 shrink-0";

// Botón de WhatsApp para usar dentro de la página (altura de 44 px: cómodo con el pulgar)
export function WhatsAppButton({ href, children, variant = "default", className }: ButtonProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant, size: "lg" }), "h-11 px-5", className)}
    >
      <FaWhatsapp className={iconClass} aria-hidden="true" />
      {children}
    </a>
  );
}

// Botón fijo en la esquina inferior: siempre a mano mientras se hace scroll.
// `max(1rem, safe-area...)` evita que lo tape la barra de gestos del iPhone.
export function WhatsAppFloating({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FaWhatsapp className={iconClass} aria-hidden="true" />
      {label}
    </a>
  );
}