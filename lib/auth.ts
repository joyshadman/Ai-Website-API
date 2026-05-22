import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma.js";
import { getTrustedOrigins } from "./cors.js";
import { getBetterAuthSecret, getBetterAuthUrl } from "./env.js";

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
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            path: "/",
          },
        },
      },
    },
  }) as unknown as AuthInstance;

  return authInstance;
}