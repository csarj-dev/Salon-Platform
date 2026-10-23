import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL!;

// Las conexiones con pooler (Neon, Supabase…) no admiten sentencias preparadas
export const pgClient = postgres(url, { prepare: !url.includes("-pooler") });
export const db = drizzle(pgClient, { schema });