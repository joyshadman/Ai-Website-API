import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma.js";
import { getTrustedOrigins } from "./cors.js";
import { getBetterAuthSecret, getBetterAuthUrl } from "./env.js";

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const isProd = process.env.NODE_ENV === "production";

type AuthInstance = ReturnType<typeof betterAuth>;

let authInstance: AuthInstance | null = null;

export function getAuth(): AuthInstance | null {
  if (authInstance) return authInstance;

  authInstance = betterAuth({
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
    },
    ...(googleClientId && googleClientSecret
      ? {
          socialProviders: {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            },
          },
        }
      : {}),
    // OAuth state lives in DB; skip signed cookie check (breaks via Vercel→Render proxy).
    account: {
      skipStateCookieCheck: true,
    },
    user: {
      deleteUser: { enabled: true },
    },
    trustedOrigins: getTrustedOrigins(),
    baseURL: getBetterAuthUrl(),
    secret: getBetterAuthSecret(),
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        secure: isProd,
        // First-party via Vercel /api proxy — lax keeps OAuth state on callback.
        sameSite: "lax",
        path: "/",
      },
    },
  }) as unknown as AuthInstance;

  return authInstance;
}
