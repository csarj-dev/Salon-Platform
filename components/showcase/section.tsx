import type { ReactNode } from "react";

type Props = {
  title: string;
  id?: string; // ancla para enlaces como /#locales
  children: ReactNode;
};

export function Section({ title, id, children }: Props) {
  return (
    // scroll-mt-20: al saltar a un ancla, deja sitio para la cabecera fija
    <section id={id} className="scroll-mt-20 py-10">
      <h2 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}