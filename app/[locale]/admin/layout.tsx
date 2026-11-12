import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";


type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Admin" });
  // El panel nunca debe aparecer en Google
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // La sesión se lee de las cookies (dinámico): todo el panel va dentro de Suspense
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[75rem] space-y-4 px-4 py-10 md:px-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}