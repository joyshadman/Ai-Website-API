import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { getTrustedOrigins, PRODUCTION_FRONTEND } from "./cors.js";
import { getBetterAuthSecret, getBetterAuthUrl, isProduction } from "./env.js";
import { authPrisma, checkBeforeCode, checkNewUser, countNewUser } from "./signupGuard.js";
import { deleteMediaKeys } from "./media.js";

const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const isProd = isProduction();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Fail fast instead of hanging the OTP request when Gmail SMTP is
  // unreachable or credentials are rejected (seen in production).
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

type AuthInstance = ReturnType<typeof betterAuth>;

let authInstance: AuthInstance | null = null;

export function getAuth(): AuthInstance | null {
  if (authInstance) return authInstance;

  authInstance = betterAuth({
    database: prismaAdapter(authPrisma, {
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
          const smtpUser = process.env.SMTP_USER?.trim();
          const smtpPass = process.env.SMTP_PASS?.trim();
          if (!smtpUser || !smtpPass) {
            throw new Error(
              "SMTP is not configured: set SMTP_USER and SMTP_PASS to send OTP emails."
            );
          }

          const subject =
            type === "email-verification"
              ? "Verify your email"
              : type === "forget-password"
                ? "Reset your password"
                : type === "change-email"
                  ? "Confirm your new email"
                  : "Your verification code";

          await transporter.sendMail({
            from: `"Apexium AI" <${smtpUser}>`,
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
      deleteUser: {
        enabled: true,
        // Projects don't cascade from the user (schema.prisma), so remove them first, with their uploads
        // in storage; versions, messages, and asset rows cascade from each project (spec 0035).
        beforeDelete: async (user) => {
          const projects = await authPrisma.websiteProject.findMany({ where: { userId: user.id }, select: { id: true } });
          const ids = projects.map(p => p.id);
          const assets = ids.length ? await authPrisma.asset.findMany({ where: { projectId: { in: ids } }, select: { key: true } }) : [];
          await authPrisma.websiteProject.deleteMany({ where: { userId: user.id } });
          await deleteMediaKeys(assets.map(a => a.key), `delete account ${user.id}`);
        },
      },
      additionalFields: {
        normalizedEmail: { type: "string", required: false, input: false, returned: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => ({ data: await checkNewUser(user, context) }),
          after: async (_user, context) => countNewUser(context),
        },
      },
    },
    hooks: {
      // A middleware, because that route sends the email in the background where a throw can't reach the client.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp") await checkBeforeCode(ctx.body);
      }),
    },
    // A refused Google sign in comes back to the sign in page, with the reason in `error`.
    onAPIError: { errorURL: `${getBetterAuthUrl()}/auth/signin` },
    trustedOrigins: getTrustedOrigins(),
    baseURL: {
      // Local hosts only outside production (spec 0034).
      allowedHosts: isProd ? ["ai-website-henna-eight.vercel.app", new URL(PRODUCTION_FRONTEND).host] : [
        "localhost:5173",
        "localhost:5174",
        "localhost:3000",
        "localhost:4173",
        "localhost:5000",
        "127.0.0.1:5173",
        "127.0.0.1:5174",
        "127.0.0.1:3000",
        "ai-website-henna-eight.vercel.app",
      ],
      fallback: PRODUCTION_FRONTEND,
    },
    secret: getBetterAuthSecret(),
    // Sign in limits (spec 0033 AC-4), kept in this process's memory like the API's own limiter.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/*": { window: 60, max: 10 },
      },
    },
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
