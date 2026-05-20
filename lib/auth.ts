import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma.js";
import { getTrustedOrigins } from "./cors.js";
import { getBetterAuthSecret, getBetterAuthUrl } from "./env.js";

let authInstance: ReturnType<typeof betterAuth> | null = null;

export function getAuth() {
  if (authInstance) return authInstance;

  authInstance = betterAuth({
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
    },
    user: {
      deleteUser: { enabled: true },
    },
    trustedOrigins: getTrustedOrigins(),
    baseURL: getBetterAuthUrl(),
    secret: getBetterAuthSecret(),
    advanced: {
      cookies: {
        session_token: {
          name: "Auth_token",
          attributes: {
            httpOnly: true,
            secure: Boolean(process.env.VERCEL),
            sameSite: process.env.VERCEL ? "none" : "lax",
            path: "/",
          },
        },
      },
    },
  });

  return authInstance;
}
