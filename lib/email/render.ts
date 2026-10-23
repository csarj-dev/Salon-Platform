// Maqueta del correo: HTML sencillo (tablas y estilos en línea, que es lo que entienden
// todos los clientes de correo) y su versión en texto plano.

export type EmailRow = { label: string; value: string; href?: string };

export type EmailLayout = {
  lang: string;
  salonName: string;
  preheader?: string;
  greeting: string;
  intro: string[];
  rows: EmailRow[];
  outro: string[];
  button?: { label: string; url: string };
  footer: string[];
  colors: { primary: string; primaryForeground: string };
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmail(l: EmailLayout): { html: string; text: string } {
  const p = (value: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(value)}</p>`;

  const rows = l.rows
    .map((row) => {
      const value = row.href
        ? `<a href="${escapeHtml(row.href)}" style="color:inherit;">${escapeHtml(row.value)}</a>`
        : escapeHtml(row.value);
      return `<tr><td style="padding:6px 16px 6px 0;color:#6b6b6b;font-size:14px;vertical-align:top;">${escapeHtml(row.label)}</td><td style="padding:6px 0;font-size:15px;vertical-align:top;">${value}</td></tr>`;
    })
    .join("");

  const button = l.button
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${l.colors.primary};color:${l.colors.primaryForeground};text-decoration:none;font-size:15px;font-weight:600;">${escapeHtml(l.button.label)}</a></p>`
    : "";

  const html = `<!doctype html>
<html lang="${escapeHtml(l.lang)}">
<body style="margin:0;padding:24px;background:#f4f4f4;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171717;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(l.preheader ?? "")}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
<tr><td style="padding:24px 32px 8px;font-size:18px;font-weight:700;">${escapeHtml(l.salonName)}</td></tr>
<tr><td style="padding:8px 32px 24px;">
${p(l.greeting)}
${l.intro.map(p).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">${rows}</table>
${l.outro.map(p).join("\n")}
${button}
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #eeeeee;font-size:13px;line-height:1.5;color:#6b6b6b;">${l.footer.map(escapeHtml).join("<br>")}</td></tr>
</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    l.greeting,
    "",
    ...l.intro.flatMap((line) => [line, ""]),
    ...l.rows.map((row) => `${row.label}: ${row.value}${row.href ? ` (${row.href})` : ""}`),
    "",
    ...l.outro.flatMap((line) => [line, ""]),
    ...(l.button ? [`${l.button.label}: ${l.button.url}`, ""] : []),
    "--",
    ...l.footer,
  ].join("\n");

  return { html, text };
}