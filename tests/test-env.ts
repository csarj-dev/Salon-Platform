// Apunta DATABASE_URL a la base de pruebas ANTES de que se cargue db/index.ts
const url =
  process.env.TEST_DATABASE_URL ??
  "postgres://salon:salon_dev@localhost:5432/salon_test";

const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith("_test")) {
  throw new Error(
    `Los tests de integración solo corren contra una base que acabe en _test (recibido: ${dbName})`,
  );
}

process.env.DATABASE_URL = url;