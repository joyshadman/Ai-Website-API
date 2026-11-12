import type { NextFunction, Request, Response } from "express";
import { isProduction } from "../lib/env.js";

/**
 * Browser security headers for every API response (spec 0032 AC-2). The API only returns JSON and
 * redirects, so it may load nothing and be framed by nothing.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  if (isProduction()) res.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
}
