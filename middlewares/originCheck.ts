import type { NextFunction, Request, Response } from "express";

/**
 * Cross site request guard (spec 0029 AC-6). A state changing request that carries an Origin the app
 * doesn't trust is refused, before any route runs. This stops a generated site (opaque origin "null")
 * or any other page from using the viewer's cookies through a simple POST or upload that CORS alone
 * can't stop. Requests with no Origin (server to server, curl) are left to the routes' own auth.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originCheck(trusted: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (!origin || trusted.includes(origin)) return next();
    res.status(403).json({ error: "This request came from a page that isn't allowed to change your account." });
  };
}
