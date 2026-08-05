"use strict";

const crypto = require("crypto");
const { CONFIG } = require("./config");
const { canonicalRequest, signRequest, hashBody } = require("./util");

const API_TIMEOUT_MS = 15_000;
const PUBLIC_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Signed request to the NYX website. Errors carry `status` (HTTP status) and
 * `friendly` (true when the message came from the website and is safe to show
 * users). Transport-level failures are not marked friendly and get a generic
 * message in the command router.
 *
 * Callers of read-only endpoints may pass `{ retries: 1 }`; a single retry is
 * attempted on connection-level failures (TypeError) or gateway 502/503/504
 * responses. Mutating calls must never auto-retry, so retries are opt-in per
 * call site.
 */
async function callAuthApi(pathname, body, options = {}) {
    const { retries = 0 } = options;
    const attempt = async (remaining) => {
        try {
            const bodyText = JSON.stringify(body);
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const nonce = crypto.randomBytes(24).toString("base64url");
            const signature = signRequest(canonicalRequest(timestamp, nonce, "POST", pathname, hashBody(bodyText)), CONFIG.API_SECRET);
            const response = await fetchWithTimeout(`${CONFIG.AUTH_URL}${pathname}`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${CONFIG.API_SECRET}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "X-NYX-Key-Id": "current",
                    "X-NYX-Timestamp": timestamp,
                    "X-NYX-Nonce": nonce,
                    "X-NYX-Signature": signature
                },
                body: bodyText
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                const error = new Error(payload.message || `Website API returned HTTP ${response.status}`);
                error.status = response.status;
                error.friendly = Boolean(payload.message);
                throw error;
            }
            return payload;
        } catch (error) {
            const retryable =
                remaining > 0 && (error?.name === "TypeError" || [502, 503, 504].includes(error?.status)) && error?.name !== "AbortError";
            if (retryable) {
                await new Promise((resolve) => setTimeout(resolve, 600));
                return attempt(remaining - 1);
            }
            throw error;
        }
    };
    return attempt(retries);
}

async function websiteHealth() {
    try {
        const response = await fetchWithTimeout(
            `${CONFIG.AUTH_URL}/api/health`,
            { headers: { Accept: "application/json" } },
            PUBLIC_TIMEOUT_MS
        );
        if (!response.ok) return { online: false, status: `HTTP ${response.status}` };
        const data = await response.json();
        return { online: true, status: data.status || "operational" };
    } catch {
        return { online: false, status: "unreachable" };
    }
}

async function fetchPublicStatus() {
    const response = await fetchWithTimeout(
        `${CONFIG.AUTH_URL}/api/status`,
        { headers: { Accept: "application/json" } },
        PUBLIC_TIMEOUT_MS
    );
    if (!response.ok) throw new Error(`NYX status endpoint returned HTTP ${response.status}`);
    return response.json();
}

module.exports = { callAuthApi, websiteHealth, fetchPublicStatus, fetchWithTimeout };
