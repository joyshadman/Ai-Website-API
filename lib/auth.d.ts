export declare const auth: import("better-auth").Auth<{
    database: (options: import("better-auth").BetterAuthOptions) => import("better-auth").DBAdapter<import("better-auth").BetterAuthOptions>;
    emailAndPassword: {
        enabled: true;
    };
    trustedOrigins: string[];
    baseURL: string;
    secret: string;
    advanced: {
        cookies: {
            session_token: {
                name: string;
                attributes: {
                    httpOnly: true;
                    secure: boolean;
                    sameSite: "none" | "lax";
                    path: string;
                };
            };
        };
    };
}>;
//# sourceMappingURL=auth.d.ts.map