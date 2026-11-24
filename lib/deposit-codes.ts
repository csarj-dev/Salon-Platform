// Código por correo para usar un depósito guardado al reservar (diseños P2, P2b, P3 y P3b).
// 1. La clienta pide el código con su teléfono y su correo: si tiene depósitos guardados que pagan
//    la reserva (mismo correo que la cita de la que salen), se le manda un código de 6 cifras.
// 2. Lo comprueba: 5 intentos; al quinto fallo, 10 minutos sin poder pedir ni comprobar otro.
// 3. Con el código bueno recibe una "prueba" que el formulario de reserva manda al reservar. La
//    reserva la gasta junto con los depósitos, en la misma transacción (lib/booking.ts).
// A quien no tiene depósito (o pone otro correo) se le dice lo mismo: así nadie averigua nada con
// un teléfono ajeno.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, gte } from "drizzle-orm";
import { db } from "../db";
import { client, depositCode } from "../db/schema";
import { collectorForStaff } from "./collectors-db";
import { depositPartsFor, matchSavedDeposits } from "./deposit-credits";

const MINUTE = 60_000;
export const CODE_TTL_MS = 10 * MINUTE; // el código vale 10 minutos
export const MAX_ATTEMPTS = 5; // intentos por código
export const LOCK_MS = 10 * MINUTE; // espera tras fallar 5 veces
export const MAX_CODES_PER_WINDOW = 3; // códigos que se pueden pedir...
export const CODES_WINDOW_MS = 10 * MINUTE; // ...en este tiempo
export const PROOF_TTL_MS = 30 * MINUTE; // tiempo para terminar la reserva tras comprobarlo

type CollectorsConfig = Parameters<typeof collectorForStaff>[1];

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hashCode = (salt: string, code: string) => sha256(`${salt}:${code}`);

// "maria@example.com" → "m•••@example.com"
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "•••";
  return `${user[0]}•••@${domain}`;
}

export function newCode(random: (max: number) => number = randomInt): string {
  return String(random(1_000_000)).padStart(6, "0");
}

export type CodeRequest = {
  phone: string; // ya normalizado (phoneSchema)
  email: string;
  serviceIds: number[];
  staffId: number; // la profesional que hará la cita (de ella sale quién cobra)
};

export type RequestCodeResult =
  | { ok: true; requestId: string; maskedEmail: string; expiresAt: Date; cents: number; code: string }
  // none: no hay depósito guardado que pague esta reserva · locked: falló 5 veces o pidió muchos
  | { ok: false; reason: "none" }
  | { ok: false; reason: "locked"; until: Date };

// Prepara un código si hay depósitos guardados que pagan la reserva. Devuelve el código para que
// quien llama lo mande por correo (y los tests lo lean); nunca va al navegador.
export async function requestDepositCode(
  req: CodeRequest,
  config: CollectorsConfig,
  now: Date = new Date(),
): Promise<RequestCodeResult> {
  const email = req.email.trim().toLowerCase();
  const [c] = await db.select({ id: client.id }).from(client).where(eq(client.phone, req.phone));
  if (!c) return { ok: false, reason: "none" };

  // ¿Bloqueada, o ha pedido ya muchos códigos?
  const recent = await db
    .select({ createdAt: depositCode.createdAt, lockedUntil: depositCode.lockedUntil })
    .from(depositCode)
    .where(
      and(
        eq(depositCode.clientId, c.id),
        gte(depositCode.createdAt, new Date(now.getTime() - CODES_WINDOW_MS - LOCK_MS)),
      ),
    )
    .orderBy(desc(depositCode.createdAt));
  const locked = recent.find((r) => r.lockedUntil && r.lockedUntil > now);
  if (locked?.lockedUntil) return { ok: false, reason: "locked", until: locked.lockedUntil };
  const inWindow = recent.filter((r) => r.createdAt.getTime() > now.getTime() - CODES_WINDOW_MS);
  if (inWindow.length >= MAX_CODES_PER_WINDOW) {
    const oldest = inWindow[inWindow.length - 1].createdAt;
    return { ok: false, reason: "locked", until: new Date(oldest.getTime() + CODES_WINDOW_MS) };
  }

  const collector = await collectorForStaff(req.staffId, config);
  const parts = await depositPartsFor(req.serviceIds);
  const match = await matchSavedDeposits(c.id, parts, collector.id, email, now);
  if (!match) return { ok: false, reason: "none" };

  const code = newCode();
  const salt = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  const [row] = await db
    .insert(depositCode)
    .values({ clientId: c.id, email, codeHash: hashCode(salt, code), salt, createdAt: now, expiresAt })
    .returning({ publicId: depositCode.publicId });
  return { ok: true, requestId: row.publicId, maskedEmail: maskEmail(email), expiresAt, cents: match.cents, code };
}

export type VerifyCodeResult =
  | { ok: true; proof: string }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "locked"; until: Date }
  // expired: caducó o ya se usó · not_found: no existe esa petición
  | { ok: false; reason: "expired" | "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyDepositCode(
  requestId: string,
  code: string,
  now: Date = new Date(),
): Promise<VerifyCodeResult> {
  if (!UUID.test(requestId)) return { ok: false, reason: "not_found" };
  const [row] = await db.select().from(depositCode).where(eq(depositCode.publicId, requestId.toLowerCase()));
  if (!row) return { ok: false, reason: "not_found" };
  if (row.lockedUntil && row.lockedUntil > now) return { ok: false, reason: "locked", until: row.lockedUntil };
  if (row.verifiedAt || row.expiresAt <= now || row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "expired" };

  const given = Buffer.from(hashCode(row.salt, code.replace(/\s/g, "")), "hex");
  const stored = Buffer.from(row.codeHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    const attempts = row.attempts + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCK_MS) : null;
    await db.update(depositCode).set({ attempts, lockedUntil }).where(eq(depositCode.id, row.id));
    if (lockedUntil) return { ok: false, reason: "locked", until: lockedUntil };
    return { ok: false, reason: "wrong", attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  const proof = randomBytes(32).toString("hex");
  // Solo una vez, aunque se compruebe dos veces a la vez
  const updated = await db
    .update(depositCode)
    .set({ verifiedAt: now, proofHash: sha256(proof) })
    .where(and(eq(depositCode.id, row.id), eq(depositCode.attempts, row.attempts)))
    .returning({ id: depositCode.id });
  if (updated.length === 0) return { ok: false, reason: "expired" };
  return { ok: true, proof };
}

export type ProofCheck = { ok: true; codeId: number; clientId: number; email: string } | { ok: false };

// La prueba que trae el formulario de reserva: comprobada hace poco, sin gastar y de esa clienta
export async function checkDepositProof(proof: string, phone: string, now: Date = new Date()): Promise<ProofCheck> {
  if (!/^[0-9a-f]{64}$/.test(proof)) return { ok: false };
  const [row] = await db
    .select({
      id: depositCode.id,
      clientId: depositCode.clientId,
      email: depositCode.email,
      consumedAt: depositCode.consumedAt,
      phone: client.phone,
    })
    .from(depositCode)
    .innerJoin(client, eq(client.id, depositCode.clientId))
    .where(and(eq(depositCode.proofHash, sha256(proof)), gt(depositCode.verifiedAt, new Date(now.getTime() - PROOF_TTL_MS))));
  if (!row || row.consumedAt || row.phone !== phone) return { ok: false };
  return { ok: true, codeId: row.id, clientId: row.clientId, email: row.email };
}

// Para lib/booking.ts: qué gasta la reserva (los depósitos y la prueba)
export type SavedDepositUse = { creditIds: number[]; codeId: number };