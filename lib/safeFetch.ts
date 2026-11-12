import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

/*
 * Safe server side fetching of user supplied URLs (spec 0030). The server must never be tricked into
 * reaching its own network: every hop is checked, and the connection is pinned to the checked address
 * so DNS can't answer differently between the check and the connect (rebinding).
 */

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|home\.arpa)$/i;

const blocked = new net.BlockList();
for (const [addr, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const) blocked.addSubnet(addr, prefix, 'ipv6');

/** The IPv4 address hidden inside an IPv6 one (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::), if any. */
function embeddedIPv4(ip: string): string | null {
    const lower = ip.toLowerCase();
    const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (dotted?.[1]) return dotted[1];
    const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hex?.[1] && hex[2]) {
        const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
        return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    }
    return null;
}

export function isBlockedAddress(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 4) return blocked.check(ip, 'ipv4');
    if (family === 6) {
        const v4 = embeddedIPv4(ip);
        return v4 ? blocked.check(v4, 'ipv4') : blocked.check(ip, 'ipv6');
    }
    return true; // not an IP at all: refuse
}

export type UrlCheck = { ok: true; url: URL; address: string; family: 4 | 6 } | { ok: false; reason: string };

/** Validates a URL and resolves it to one safe address to connect to (AC-1). */
export async function checkUrl(raw: string): Promise<UrlCheck> {
    let url: URL;
    try { url = new URL(raw); } catch { return { ok: false, reason: "it isn't a valid web address" }; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'only http and https addresses are allowed' };
    if (url.username || url.password) return { ok: false, reason: 'addresses with a user name or password are not allowed' };
    if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: 'only the standard web ports are allowed' };
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (BLOCKED_NAMES.test(host)) return { ok: false, reason: 'it points to a private network address' };

    let answers: { address: string; family: number }[];
    if (net.isIP(host)) answers = [{ address: host, family: net.isIP(host) }];
    else {
        try { answers = await dns.lookup(host, { all: true, verbatim: true }); }
        catch { return { ok: false, reason: "that website couldn't be found" }; }
    }
    if (answers.length === 0) return { ok: false, reason: "that website couldn't be found" };
    // Every answer must be public: a name with one private answer could be steered to it.
    if (answers.some(a => isBlockedAddress(a.address))) return { ok: false, reason: 'it points to a private network address' };
    const first = answers[0];
    if (!first) return { ok: false, reason: "that website couldn't be found" };
    return { ok: true, url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

export type FetchResult = { ok: true; text: string; finalUrl: string } | { ok: false; reason: string };

function requestOnce(check: Extract<UrlCheck, { ok: true }>, signal: AbortSignal): Promise<
    { kind: 'redirect'; location: string } | { kind: 'body'; text: string } | { kind: 'refused'; reason: string }
> {
    return new Promise((resolve) => {
        const { url, address, family } = check;
        // Pin the connection to the checked address (AC-2): no second DNS answer can sneak in.
        const lookup: LookupFunction = (_hostname, options, cb) => {
            if (options && (options as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
            else cb(null, address, family);
        };
        const mod = url.protocol === 'https:' ? https : http;
        const req = mod.get(url, {
            lookup,
            signal,
            headers: { 'User-Agent': 'ApexiumReferenceFetcher/1.0', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' },
        }, (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                return resolve({ kind: 'redirect', location: new URL(res.headers.location, url).toString() });
            }
            if (status < 200 || status >= 300) { res.resume(); return resolve({ kind: 'refused', reason: `the site answered ${status}` }); }
            const type = String(res.headers['content-type'] ?? '').toLowerCase();
            if (!/^text\/|^application\/xhtml\+xml/.test(type)) { res.resume(); return resolve({ kind: 'refused', reason: 'it is not a web page' }); }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_BYTES) {
                    chunks.push(chunk.subarray(0, chunk.length - (size - MAX_BYTES)));
                    res.destroy(); // stop reading past the cap (AC-2)
                    return;
                }
                chunks.push(chunk);
            });
            res.on('close', () => resolve({ kind: 'body', text: Buffer.concat(chunks).toString('utf8') }));
            res.on('error', () => resolve({ kind: 'body', text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', (e) => resolve({ kind: 'refused', reason: signal.aborted ? 'it took too long to answer' : `it couldn't be reached (${(e as NodeJS.ErrnoException).code ?? 'error'})` }));
    });
}

/** Fetches a page's text with every hop checked, the address pinned, and size, time, and redirects capped (AC-2). */
export async function safeFetchText(raw: string): Promise<FetchResult> {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let current = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const check = await checkUrl(current);
        if (!check.ok) return { ok: false, reason: hop === 0 ? check.reason : `it redirected to an address that ${check.reason.replace(/^it /, '')}` };
        const r = await requestOnce(check, signal);
        if (r.kind === 'body') return { ok: true, text: r.text, finalUrl: current };
        if (r.kind === 'refused') return { ok: false, reason: r.reason };
        current = r.location;
    }
    return { ok: false, reason: 'it redirected too many times' };
}
