import { Suspense } from "react";
import { asc } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { PanelSkeleton } from "@/components/admin/panel-skeleton";
import { UserRow } from "@/components/admin/user-row";
import { requireStaff } from "@/lib/session";
import { PageHeader } from "@/components/admin/panel-ui";

type Props = { params: Promise<{ locale: string }> };

export default async function UsersPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Admin.users" });

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("intro")} />
      <Suspense fallback={<PanelSkeleton />}>
        <UsersContent locale={locale} />
      </Suspense>
    </section>
  );
}

async function UsersContent({ locale }: { locale: string }) {
  // Solo el administrador gestiona usuarios (si no, 404)
  const { user: actor } = await requireStaff(locale, "users.manage");
  const users = await db.select().from(user).orderBy(asc(user.createdAt));

  return (
    <>
      <CreateUserForm />
      <ul className="space-y-3">
        {users.map((u) => (
          <UserRow
            key={u.id}
            id={u.id}
            name={u.name}
            email={u.email}
            role={u.role}
            banned={Boolean(u.banned)}
            isSelf={u.id === actor.id}
          />
        ))}
      </ul>
    </>
  );
}