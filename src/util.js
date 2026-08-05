"use strict";

const fs = require("fs");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// JSON state helpers
// ---------------------------------------------------------------------------

/**
 * Read a JSON file, returning `fallback` if it is missing or corrupt.
 * If the file exists but cannot be parsed, the raw bytes are moved to a
 * `.corrupt-<timestamp>` backup before returning the fallback, so state is
 * never silently lost on a crash or a partially-written file.
 */
function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        if (error && error.code === "ENOENT") return fallback;
        try {
            const backup = `${file}.corrupt-${Date.now()}`;
            fs.renameSync(file, backup);
            console.error(`[NYX BOT] Recovered corrupt state file ${file} -> ${backup}: ${error.message}`);
        } catch {
            /* best effort backup */
        }
        return fallback;
    }
}

/**
 * Atomically write JSON: write to a temp file in the same directory, then
 * rename over the target. A crash mid-write can never truncate the live file.
 */
function writeJsonAtomic(file, data, pretty = false) {
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const serialized = pretty ? JSON.stringify(data, null, 4) : JSON.stringify(data);
    fs.writeFileSync(temp, serialized);
    fs.renameSync(temp, file);
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/** Clamp a numeric env value into [min, max]; falls back when unset/invalid. */
function clampInt(value, fallback, min, max) {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** Split a comma-separated env value into trimmed, non-empty strings. */
function splitCsv(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

/** Parse a boolean env value; falls back when unset or unrecognized. */
function parseBool(value, fallback = false) {
    if (value == null || value === "") return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
    return fallback;
}

/**
 * Extract the first license-key-looking token from free text (used by the
 * "Check license key" message context menu). Accepts 12–80 character tokens
 * of letters, digits and dashes that contain at least one letter and one
 * digit, so normal sentences are never matched.
 */
function extractLicenseKey(text) {
    if (!text) return null;
    const tokens = String(text).match(/[A-Za-z0-9][A-Za-z0-9-]{11,79}/gu) || [];
    for (const token of tokens) {
        const hasLetter = /[A-Za-z]/u.test(token);
        const hasDigit = /[0-9]/u.test(token);
        if (hasLetter && hasDigit && !token.includes("--")) return token;
    }
    return null;
}

/**
 * Accept either a raw Discord message ID or a Discord message link
 * (https://discord.com/channels/guild/channel/message), returning the ID.
 */
function parseMessageId(linkOrId) {
    if (!linkOrId) return null;
    const value = String(linkOrId).trim();
    if (/^\d{15,20}$/u.test(value)) return value;
    const match = value.match(/(\d{15,20})[/?]?$/u);
    return match ? match[1] : null;
}

/**
 * Decide whether a member may claim from a giveaway. Pure and unit-testable;
 * callers map the reason codes to user-facing messages.
 */
function evaluateClaimGate({
    requireLinked,
    linked,
    requiredRoleId,
    memberRoleIds = [],
    cooldownMs = 0,
    lastClaimAtMs = 0,
    now = Date.now()
}) {
    if (requiredRoleId && !memberRoleIds.includes(requiredRoleId)) {
        return { allowed: false, reason: "role" };
    }
    if (requireLinked && !linked) {
        return { allowed: false, reason: "linked" };
    }
    if (cooldownMs > 0 && lastClaimAtMs && now - lastClaimAtMs < cooldownMs) {
        return { allowed: false, reason: "cooldown", waitMinutes: Math.max(1, Math.ceil((cooldownMs - (now - lastClaimAtMs)) / 60_000)) };
    }
    return { allowed: true };
}

/**
 * Human-readable launch-readiness message for /mystatus and /verify.
 * Mirrors the website's `result.reason` codes.
 */
function launchReadinessMessage(result) {
    if (result.active) {
        return result.account?.deviceId ? "READY TO LAUNCH" : "Launch blocked — no device bound. Launch NYX once to bind your hardware.";
    }
    return (
        {
            revoked: "Launch blocked — your license was revoked.",
            paused: "Launch blocked — your license is paused.",
            expired: "Launch blocked — your license has expired.",
            device_unbound: "Launch blocked — no device bound.",
            not_linked: "Launch blocked — Discord is not linked."
        }[result.reason] || "Launch blocked — see the dashboard."
    );
}

// ---------------------------------------------------------------------------
// Display helpers (pure, no discord.js dependency so they are unit-testable)
// ---------------------------------------------------------------------------

function formatTimestamp(value) {
    if (!value) return "Not set";
    return `<t:${Math.floor(Number(value))}:F>`;
}

function licenseState(license) {
    if (license.revokedAt) return "Revoked";
    if (license.pausedAt) return "Paused";
    if (license.expiresAt && Number(license.expiresAt) <= Math.floor(Date.now() / 1000)) return "Expired";
    if (!license.activatedAt) return "Unused";
    return "Active";
}

function ticketChannelName(username) {
    const slug =
        String(username || "user")
            .toLowerCase()
            .replace(/[^a-z0-9-_]/gu, "")
            .replace(/-+/gu, "-")
            .replace(/^-+|-+$/gu, "")
            .slice(0, 80) || "user";
    return `ticket-${slug}`.slice(0, 100);
}

// ---------------------------------------------------------------------------
// Request signing helpers (pure, so the canonical form is unit-testable)
// ---------------------------------------------------------------------------

function canonicalRequest(timestamp, nonce, method, pathname, bodyHash) {
    return `${timestamp}\n${nonce}\n${method}\n${pathname}\n${bodyHash}`;
}

function signRequest(canonical, secret) {
    return crypto.createHmac("sha256", secret).update(canonical).digest("base64url");
}

function hashBody(bodyText) {
    return crypto.createHash("sha256").update(bodyText).digest("base64url");
}

// ---------------------------------------------------------------------------
// Rate limiter with bounded memory
// ---------------------------------------------------------------------------

/**
 * Sliding-window per-key limiter. Entries for idle keys are swept
 * periodically so the map cannot grow without bound.
 */
class RateLimiter {
    constructor(limit, windowMs, now = Date.now) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.now = now;
        this.entries = new Map();
        this.lastPrune = 0;
    }

    allow(key) {
        this.#prune();
        const now = this.now();
        const timestamps = (this.entries.get(key) || []).filter((time) => now - time < this.windowMs);
        if (timestamps.length >= this.limit) {
            this.entries.set(key, timestamps);
            return false;
        }
        timestamps.push(now);
        this.entries.set(key, timestamps);
        return true;
    }

    #prune() {
        const now = this.now();
        if (now - this.lastPrune < 60_000) return;
        this.lastPrune = now;
        for (const [key, timestamps] of this.entries) {
            if (timestamps.every((time) => now - time >= this.windowMs)) this.entries.delete(key);
        }
    }
}

// ---------------------------------------------------------------------------
// Poll backoff: back off exponentially while the API keeps failing, and log
// the recovery transition so a down website does not spam logs every tick.
// ---------------------------------------------------------------------------

function makeBackoff(initialMs, maxMs) {
    let failures = 0;
    let nextAllowedAt = 0;
    return {
        allow() {
            return Date.now() >= nextAllowedAt;
        },
        success() {
            const wasDown = failures > 0;
            failures = 0;
            nextAllowedAt = 0;
            return wasDown;
        },
        failure() {
            failures += 1;
            nextAllowedAt = Date.now() + Math.min(maxMs, initialMs * 2 ** (failures - 1));
        },
        failures() {
            return failures;
        }
    };
}

module.exports = {
    readJson,
    writeJsonAtomic,
    clampInt,
    splitCsv,
    parseBool,
    extractLicenseKey,
    parseMessageId,
    evaluateClaimGate,
    launchReadinessMessage,
    formatTimestamp,
    licenseState,
    ticketChannelName,
    canonicalRequest,
    signRequest,
    hashBody,
    RateLimiter,
    makeBackoff
};
