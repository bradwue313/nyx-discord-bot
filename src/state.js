"use strict";

const path = require("path");
const { CONFIG } = require("./config");
const { readJson, writeJsonAtomic } = require("./util");
const { callAuthApi } = require("./api");

// ---------------------------------------------------------------------------
// Server allowlist (env seed + runtime /owner allow|deny)
// ---------------------------------------------------------------------------

const allowedServers = new Set(CONFIG.ALLOWED_GUILD_IDS);
{
    const parsed = readJson(CONFIG.ALLOWED_SERVERS_FILE, []);
    if (Array.isArray(parsed)) {
        for (const id of parsed) if (typeof id === "string" && id) allowedServers.add(id);
    }
}

function saveAllowedServers() {
    try {
        writeJsonAtomic(CONFIG.ALLOWED_SERVERS_FILE, [...allowedServers], true);
    } catch (error) {
        console.error(`[NYX BOT] Could not persist server allowlist: ${error.message}`);
    }
}

function addAllowedServer(guildId) {
    allowedServers.add(guildId);
    saveAllowedServers();
}

function removeAllowedServer(guildId) {
    allowedServers.delete(guildId);
    saveAllowedServers();
}

function isAllowedGuild(guildId) {
    return Boolean(guildId && allowedServers.has(guildId));
}

function getAllowedServers() {
    return allowedServers;
}

// ---------------------------------------------------------------------------
// Per-guild generator roles, cached in memory and invalidated on write
// ---------------------------------------------------------------------------

const allowedRolesCache = new Map(); // guildId -> string[]

function loadAllowedRoles(guildId) {
    if (allowedRolesCache.has(guildId)) return allowedRolesCache.get(guildId);
    const parsed = readJson(CONFIG.ALLOWED_ROLES_FILE, {});
    const list = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed[guildId] : undefined;
    const roles = Array.isArray(list) ? list.filter((value) => typeof value === "string") : [];
    allowedRolesCache.set(guildId, roles);
    return roles;
}

function saveAllowedRoles(guildId, roles) {
    const store = readJson(CONFIG.ALLOWED_ROLES_FILE, {});
    store[guildId] = [...new Set(roles)];
    try {
        writeJsonAtomic(CONFIG.ALLOWED_ROLES_FILE, store, true);
    } catch (error) {
        console.error(`[NYX BOT] Could not persist generator roles: ${error.message}`);
    }
    allowedRolesCache.set(guildId, [...new Set(roles)]);
}

// ---------------------------------------------------------------------------
// Giveaway state: messageId -> { keys, claimed, duration }, plus per-guild
// cooldowns. Persisted both to the website (source of truth) and to local
// JSON files as fallback, so restarts do not lose unclaimed keys.
// ---------------------------------------------------------------------------

const GIVEAWAY_FILE = path.join(CONFIG.STATE_DIR, "giveaways.json");
const GIVEAWAY_COOLDOWN_FILE = path.join(CONFIG.STATE_DIR, "giveaway_cooldowns.json");

let giveaways = new Map();
{
    const parsed = readJson(GIVEAWAY_FILE, {});
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) giveaways = new Map(Object.entries(parsed));
}

let lastGiveawayAt = {};
{
    const parsed = readJson(GIVEAWAY_COOLDOWN_FILE, {});
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) lastGiveawayAt = parsed;
}

function getGiveaways() {
    return giveaways;
}

function getLastGiveawayAt() {
    return lastGiveawayAt;
}

function setGiveawaysFromWebsite(entries) {
    giveaways = new Map(Object.entries(entries));
}

function setLastGiveawayAtFromWebsite(entries) {
    lastGiveawayAt = entries;
}

function saveGiveawaysLocal() {
    try {
        writeJsonAtomic(GIVEAWAY_FILE, Object.fromEntries(giveaways));
    } catch (error) {
        console.error(`[NYX BOT] Could not persist giveaways: ${error.message}`);
    }
}

function saveGiveawayCooldownsLocal() {
    try {
        writeJsonAtomic(GIVEAWAY_COOLDOWN_FILE, lastGiveawayAt);
    } catch (error) {
        console.error(`[NYX BOT] Could not persist giveaway cooldowns: ${error.message}`);
    }
}

async function persistGiveawayState() {
    const payload = { giveaways: Object.fromEntries(giveaways), cooldowns: lastGiveawayAt };
    try {
        await callAuthApi("/api/bot/giveaways", payload);
        return true;
    } catch (error) {
        console.error(`[NYX BOT] Could not sync giveaways to website: ${error.message}`);
        saveGiveawaysLocal();
        saveGiveawayCooldownsLocal();
        return false;
    }
}

// Serialize giveaway writes so concurrent claims cannot interleave partial
// state between the website sync and the local fallback.
let giveawayWriteChain = Promise.resolve();

function queueGiveawaySave() {
    giveawayWriteChain = giveawayWriteChain.then(() => persistGiveawayState());
    return giveawayWriteChain;
}

function flushGiveawaysLocal() {
    saveGiveawaysLocal();
    saveGiveawayCooldownsLocal();
}

// ---------------------------------------------------------------------------
// Expiry reminders: licenses whose expiry has already been announced
// ---------------------------------------------------------------------------

const EXPIRY_REMINDER_FILE = path.join(CONFIG.STATE_DIR, "expiry_reminders.json");
let announcedExpiries = {};
{
    const parsed = readJson(EXPIRY_REMINDER_FILE, {});
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) announcedExpiries = parsed;
}

function saveAnnouncedExpiries() {
    try {
        writeJsonAtomic(EXPIRY_REMINDER_FILE, announcedExpiries);
    } catch (error) {
        console.error(`[NYX BOT] Could not persist expiry reminders: ${error.message}`);
    }
}

// ---------------------------------------------------------------------------
// Pending confirmation actions (ephemeral, pruned on an interval)
// ---------------------------------------------------------------------------

const pendingActions = new Map(); // id -> { action, key?, message?, userId, guildId, expiresAt }

// Track repeated DM delivery failures so a user with DMs closed cannot pin the
// notification queue forever. Values are { count, at }.
const deliveryAttempts = new Map();

function pruneSessions() {
    const now = Date.now();
    for (const [id, pending] of pendingActions.entries()) {
        if (pending.expiresAt < now) pendingActions.delete(id);
    }
    for (const [key, record] of deliveryAttempts.entries()) {
        if (now - record.at > 24 * 60 * 60 * 1000) deliveryAttempts.delete(key);
    }
}

function recordDeliveryFailure(key) {
    const record = deliveryAttempts.get(key) || { count: 0, at: Date.now() };
    record.count += 1;
    record.at = Date.now();
    deliveryAttempts.set(key, record);
    return record.count;
}

function clearDeliveryFailure(key) {
    deliveryAttempts.delete(key);
}

module.exports = {
    isAllowedGuild,
    getAllowedServers,
    addAllowedServer,
    removeAllowedServer,
    loadAllowedRoles,
    saveAllowedRoles,
    getGiveaways,
    getLastGiveawayAt,
    setGiveawaysFromWebsite,
    setLastGiveawayAtFromWebsite,
    queueGiveawaySave,
    flushGiveawaysLocal,
    announcedExpiries,
    saveAnnouncedExpiries,
    pendingActions,
    pruneSessions,
    recordDeliveryFailure,
    clearDeliveryFailure
};
