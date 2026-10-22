import { asc } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { UserRow } from "@/components/admin/user-row";
import { requireStaff } from "@/lib/session";

type Props = { params: Promise<{ locale: string }> };

export default async function UsersPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Solo el administrador gestiona usuarios (si no, 404)
  const { user: actor } = await requireStaff(locale, "users.manage");
  const [t, users] = await Promise.all([
    getTranslations({ locale, namespace: "Admin.users" }),
    db.select().from(user).orderBy(asc(user.createdAt)),
  ]);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
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
    </section>
  );
}