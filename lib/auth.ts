import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/auth-schema";
import { ac, roles } from "./auth-access";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  user: {
    // Declarado aquí para que Better Auth lo conozca (y su CLI no lo quite del esquema).
    // input: false → nadie puede escribirlo desde la API.
    additionalFields: {
      lastLoginAt: { type: "date", required: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Cada sesión nueva es un inicio de sesión: lo apuntamos en el usuario,
        // porque la sesión se borra al cerrar sesión o al desactivarlo.
        after: async (session) => {
          // Si el admin suplanta a alguien, no cuenta como acceso de esa persona
          if ((session as { impersonatedBy?: string | null }).impersonatedBy) return;
          try {
            await db
              .update(user)
              .set({ lastLoginAt: new Date() })
              .where(eq(user.id, session.userId));
          } catch (error) {
            // Que un fallo aquí nunca impida entrar al panel
            console.error("[auth] lastLoginAt", error);
          }
        },
      },
    },
  },
  plugins: [
    admin({ ac, roles, defaultRole: "reception" }),
    nextCookies(), // siempre el último: sin él, las Server Actions no guardan la cookie de sesión
  ],
});