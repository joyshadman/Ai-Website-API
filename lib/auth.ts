import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import nodemailer from "nodemailer";
import prisma from "./prisma.js";
import { getTrustedOrigins, PRODUCTION_FRONTEND } from "./cors.js";
import { getBetterAuthSecret } from "./env.js";

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const isProd = process.env.NODE_ENV === "production";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

type AuthInstance = ReturnType<typeof betterAuth>;

let authInstance: AuthInstance | null = null;

export function getAuth(): AuthInstance | null {
  if (authInstance) return authInstance;

  authInstance = betterAuth({
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),

    emailAndPassword: {
      enabled: false,
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

    plugins: [
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          const subject =
            type === "email-verification"
              ? "Verify your email"
              : type === "forget-password"
                ? "Reset your password"
                : type === "change-email"
                  ? "Confirm your new email"
                  : "Your verification code";

          await transporter.sendMail({
            from: `"Your App Name" <${process.env.SMTP_USER}>`,
            to: email,
            subject,
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:auto">
                <h2>${subject}</h2>
                <p>Use the code below to continue. It expires in <strong>10 minutes</strong>.</p>
                <div style="font-size:2rem;font-weight:bold;letter-spacing:0.3em;padding:16px;background:#f4f4f4;border-radius:8px;text-align:center">
                  ${otp}
                </div>
                <p style="color:#888;font-size:0.85rem;margin-top:16px">
                  If you didn't request this, you can safely ignore this email.
                </p>
              </div>
            `,
          });
        },
        expiresIn: 600,
        sendVerificationOnSignUp: true,
      }),
    ],

    account: {
      skipStateCookieCheck: isProd,
    },
    user: {
      deleteUser: { enabled: true },
    },
    trustedOrigins: getTrustedOrigins(),
    baseURL: {
      allowedHosts: [
        "localhost:5173",
        "localhost:3000",
        "localhost:4173",
        "localhost:5000",
        "127.0.0.1:5173",
        "127.0.0.1:3000",
        "ai-website-henna-eight.vercel.app",
      ],
      fallback: PRODUCTION_FRONTEND,
    },
    secret: getBetterAuthSecret(),
    advanced: {
      trustedProxyHeaders: true,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" as const : "lax" as const,
        path: "/",
      },
    },
  }) as unknown as AuthInstance;

  return authInstance;
}
