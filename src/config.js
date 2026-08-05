"use strict";

const path = require("path");
const { clampInt, parseBool, splitCsv } = require("./util");

/**
 * Build the runtime configuration from an environment object. Kept pure so it
 * can be unit-tested with a fake env; the module-level CONFIG below is the
 * live configuration derived from process.env.
 */
function parseConfig(env = process.env) {
    return {
        TOKEN: env.BOT_TOKEN,
        CLIENT_ID: env.CLIENT_ID,
        AUTH_URL: (env.NYX_AUTH_URL || "").replace(/\/+$/, ""),
        API_SECRET: env.BOT_API_SECRET,
        AUDIT_LOG_CHANNEL_ID: env.AUDIT_LOG_CHANNEL_ID || "",
        // Comma-separated guild IDs the bot is allowed to operate in. Empty
        // means the bot refuses every command (fail-closed) until a server is
        // added via ALLOWED_GUILD_IDS or the /owner allow command.
        ALLOWED_GUILD_IDS: splitCsv(env.ALLOWED_GUILD_IDS),
        // Comma-separated Discord user IDs that bypass the allowlist and own the bot.
        BOT_OWNER_IDS: splitCsv(env.BOT_OWNER_IDS),
        ALLOWED_ROLES_FILE: path.join(__dirname, "..", "allowed_roles.json"),
        ALLOWED_SERVERS_FILE: path.join(__dirname, "..", "allowed_servers.json"),
        // Giveaway tuning: hard cap on keys per giveaway, per-guild cooldown in
        // minutes between giveaways, and an optional scheduled auto-giveaway that
        // posts to GIVEAWAY_CHANNEL_ID every GIVEAWAY_AUTO_INTERVAL_HOURS hours.
        GIVEAWAY_MAX_KEYS: clampInt(env.GIVEAWAY_MAX_KEYS, 10, 1, 25),
        GIVEAWAY_COOLDOWN_MINUTES: clampInt(env.GIVEAWAY_COOLDOWN_MINUTES, 0, 0, 24 * 60),
        GIVEAWAY_CHANNEL_ID: env.GIVEAWAY_CHANNEL_ID || "",
        GIVEAWAY_AUTO_INTERVAL_HOURS: clampInt(env.GIVEAWAY_AUTO_INTERVAL_HOURS, 0, 0, 24 * 7),
        GIVEAWAY_AUTO_DURATION: env.GIVEAWAY_AUTO_DURATION || "1w",
        GIVEAWAY_AUTO_COUNT: clampInt(env.GIVEAWAY_AUTO_COUNT, 3, 1, 25),
        // Optional support ticket category, transcript archive channel, and
        // scheduled digest channel. The digest can run every
        // DIGEST_INTERVAL_HOURS hours, or at a fixed daily time when
        // DIGEST_TIME is set (HH:MM, 24-hour UTC).
        TICKET_CATEGORY_ID: env.TICKET_CATEGORY_ID || "",
        TICKET_TRANSCRIPT_CHANNEL_ID: env.TICKET_TRANSCRIPT_CHANNEL_ID || "",
        DIGEST_CHANNEL_ID: env.DIGEST_CHANNEL_ID || "",
        DIGEST_INTERVAL_HOURS: clampInt(env.DIGEST_INTERVAL_HOURS, 0, 0, 24 * 7),
        DIGEST_TIME: env.DIGEST_TIME || "",
        // Verification role: assigned to members whose Discord is linked to an
        // active license (/verify, on join, and cleaned up by /verifysync).
        VERIFY_ROLE_ID: env.VERIFY_ROLE_ID || "",
        // Giveaway claim gating (all optional): a required role, a required
        // linked NYX account, and a per-user cooldown between claims.
        GIVEAWAY_REQUIRED_ROLE_ID: env.GIVEAWAY_REQUIRED_ROLE_ID || "",
        GIVEAWAY_REQUIRE_LINKED: parseBool(env.GIVEAWAY_REQUIRE_LINKED, false),
        GIVEAWAY_CLAIM_COOLDOWN_MINUTES: clampInt(env.GIVEAWAY_CLAIM_COOLDOWN_MINUTES, 0, 0, 24 * 60),
        // Per-user rate limit for public API commands (/mystatus, /redeem, /verify).
        PUBLIC_RATE_LIMIT_PER_MINUTE: clampInt(env.PUBLIC_RATE_LIMIT_PER_MINUTE, 10, 1, 120),
        // Where the bot keeps its JSON state files (repo root).
        STATE_DIR: path.join(__dirname, "..")
    };
}

const CONFIG = parseConfig();

const REQUIRED_ENV = [
    ["BOT_TOKEN", CONFIG.TOKEN],
    ["CLIENT_ID", CONFIG.CLIENT_ID],
    ["NYX_AUTH_URL", CONFIG.AUTH_URL],
    ["BOT_API_SECRET", CONFIG.API_SECRET]
];

function validateConfig() {
    const missing = REQUIRED_ENV.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) {
        console.error(`[NYX BOT] Missing required environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
        process.exit(1);
    }
    if (CONFIG.DIGEST_TIME && !/^\d{1,2}:\d{2}$/u.test(CONFIG.DIGEST_TIME)) {
        console.error(
            `[NYX BOT] DIGEST_TIME must be HH:MM in 24-hour UTC (got "${CONFIG.DIGEST_TIME}"). Falling back to DIGEST_INTERVAL_HOURS.`
        );
        CONFIG.DIGEST_TIME = "";
    }
    return CONFIG;
}

module.exports = { CONFIG, parseConfig, validateConfig };
