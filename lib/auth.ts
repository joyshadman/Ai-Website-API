import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma.js";
import { getTrustedOrigins } from "./cors.js";
import { getBetterAuthSecret, getBetterAuthUrl } from "./env.js";

const crossOriginCookies = Boolean(process.env.VERCEL);

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    emailAndPassword: {
        enabled: true,
    },
    user: {
        deleteUser: { enabled: true }
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
                    secure: crossOriginCookies,
                    sameSite: crossOriginCookies ? "none" : "lax",
                    path: "/",
                },
            },
        },
    },
});
