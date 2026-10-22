import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "../db";
import { ac, roles } from "./auth-access";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [
    admin({ ac, roles, defaultRole: "reception" }),
    nextCookies(), // siempre el último: sin él, las Server Actions no guardan la cookie de sesión
  ],
});