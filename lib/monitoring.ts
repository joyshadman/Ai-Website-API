import * as Sentry from '@sentry/node';

/*
 * API error reporting (spec 0036). Off unless SENTRY_DSN is set. No personal data: no IPs, cookies,
 * headers, request bodies, or emails; only the route, the error, and an opaque user id when known.
 */
const DSN = process.env.SENTRY_DSN?.trim();
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const scrub = (v?: string) => v?.replace(EMAIL, '[email]');

export const monitoringEnabled = Boolean(DSN);

if (DSN) {
    Sentry.init({
        dsn: DSN,
        environment: process.env.RENDER === 'true' ? 'production' : process.env.NODE_ENV ?? 'development',
        // Sentry 11: collect no personal data at the source (beforeSend below is a second layer).
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
        tracesSampleRate: 0,
        beforeSend(event) {
            if (event.request) {
                delete event.request.cookies;
                delete event.request.headers;
                delete event.request.data;
                delete event.request.query_string;
            }
            if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
            if (event.message) event.message = scrub(event.message) ?? event.message;
            for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrub(ex.value) ?? ex.value;
            return event;
        },
    });
}

/** Reports a server error with its context (the route and an opaque user id). Never throws. */
export function reportServerError(error: unknown, context: { where: string; userId?: string | undefined; route?: string }) {
    if (!DSN) return;
    try {
        Sentry.withScope(scope => {
            scope.setTag('where', context.where);
            if (context.route) scope.setTag('route', context.route);
            if (context.userId) scope.setUser({ id: context.userId });
            Sentry.captureException(error);
        });
    } catch { /* reporting must never break a response */ }
}
