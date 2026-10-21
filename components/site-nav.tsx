"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";

type NavLink = { href: string; label: string };

type Props = {
  links: NavLink[];
  navLabel: string;
  openLabel: string;
  closeLabel: string;
};

export function SiteNav({ links, navLabel, openLabel, closeLabel }: Props) {
  const [open, setOpen] = useState(false);

  // Escape cierra el menú
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="flex items-center gap-4">
        <nav aria-label={navLabel} className="hidden md:block">
          <ul className="flex items-center gap-6 text-sm font-medium">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex h-11 items-center hover:underline underline-offset-4">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <LocaleSwitcher />

        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? closeLabel : openLabel}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted md:hidden"
        >
          {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <nav
          id="mobile-menu"
          aria-label={navLabel}
          className="absolute inset-x-0 top-full border-b bg-background md:hidden"
        >
          <ul className="mx-auto max-w-3xl px-6 py-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center text-base font-medium"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}