import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma.js";

const trustedOrigins = (process.env.TRUSTED_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

/** Cross-site cookies only when API and frontend are on different Vercel origins. */
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
    trustedOrigins,
    baseURL: process.env.BETTER_AUTH_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,
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