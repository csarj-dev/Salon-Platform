import { createAuthClient } from "better-auth/client";
import { adminClient } from "better-auth/client/plugins";
import { ac, roles } from "./auth-access";

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles })],
});