"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
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
    RateLimiter,
    makeBackoff
} = require("../src/util");

test("clampInt clamps into [min, max]", () => {
    assert.equal(clampInt("5", 10, 1, 25), 5);
    assert.equal(clampInt("100", 10, 1, 25), 25);
    assert.equal(clampInt("0", 10, 1, 25), 1);
});

test("clampInt falls back on missing or invalid values", () => {
    assert.equal(clampInt(undefined, 10, 1, 25), 10);
    assert.equal(clampInt("abc", 10, 1, 25), 10);
    assert.equal(clampInt("", 3, 1, 25), 3); // empty env value -> fallback
    assert.equal(clampInt("0", 3, 1, 25), 1); // explicit zero is still clamped
});

test("splitCsv trims and drops empties", () => {
    assert.deepEqual(splitCsv("a, b ,, c"), ["a", "b", "c"]);
    assert.deepEqual(splitCsv(undefined), []);
    assert.deepEqual(splitCsv(""), []);
});

test("formatTimestamp handles empty and valid values", () => {
    assert.equal(formatTimestamp(null), "Not set");
    assert.equal(formatTimestamp(""), "Not set");
    assert.equal(formatTimestamp("1710000000"), "<t:1710000000:F>");
});

test("licenseState precedence: revoked > paused > expired > unused > active", () => {
    assert.equal(licenseState({ revokedAt: 1, pausedAt: 1 }), "Revoked");
    assert.equal(licenseState({ pausedAt: 1 }), "Paused");
    assert.equal(licenseState({ activatedAt: 1, expiresAt: "1" }), "Expired");
    assert.equal(licenseState({ activatedAt: 0, expiresAt: null }), "Unused");
    assert.equal(licenseState({ activatedAt: 1 }), "Active");
});

test("ticketChannelName slugs usernames safely", () => {
    // Spaces and punctuation are stripped entirely (not replaced with hyphens).
    assert.equal(ticketChannelName("John Doe!"), "ticket-johndoe");
    assert.equal(ticketChannelName("日本語"), "ticket-user");
    assert.equal(ticketChannelName(""), "ticket-user");
    assert.equal(ticketChannelName(undefined), "ticket-user");
    const long = ticketChannelName("a".repeat(120));
    assert.ok(long.length <= 100);
    assert.ok(long.startsWith("ticket-"));
});

test("RateLimiter enforces the window and prunes idle keys", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    assert.equal(limiter.allow("u1"), true);
    assert.equal(limiter.allow("u1"), true);
    assert.equal(limiter.allow("u1"), false); // 3rd hit inside window denied
    assert.equal(limiter.allow("u2"), true); // other keys unaffected

    now = 60_500; // outside the window and past the 60s prune threshold
    limiter.allow("u1"); // triggers the prune sweep
    assert.equal(limiter.allow("u1"), true); // window reset
    assert.equal(limiter.entries.size, 1); // idle "u2" pruned
});

test("makeBackoff backs off and recovers", () => {
    const backoff = makeBackoff(1000, 4000);
    assert.equal(backoff.allow(), true);
    backoff.failure();
    backoff.failure();
    assert.equal(backoff.allow(), false); // 2s of backoff not elapsed
    const recovered = backoff.success();
    assert.equal(recovered, true); // was down -> recovery is reported
    assert.equal(backoff.allow(), true);
});

test("readJson/writeJsonAtomic round-trip", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nyx-util-"));
    const file = path.join(dir, "state.json");
    writeJsonAtomic(file, { a: 1, list: [1, 2, 3] });
    assert.deepEqual(readJson(file, {}), { a: 1, list: [1, 2, 3] });
    // Missing file -> fallback
    assert.deepEqual(readJson(path.join(dir, "nope.json"), "fallback"), "fallback");
    // Corrupt file -> fallback, and the bytes are preserved as a backup
    fs.writeFileSync(file, "{ not json");
    assert.deepEqual(readJson(file, "fallback"), "fallback");
    const backups = fs.readdirSync(dir).filter((name) => name.includes("corrupt"));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, backups[0]), "utf8"), "{ not json");
});

test("parseBool handles common true/false spellings", () => {
    for (const truthy of ["1", "true", "TRUE", "yes", "on", "enabled"]) assert.equal(parseBool(truthy), true);
    for (const falsy of ["0", "false", "no", "off", "disabled"]) assert.equal(parseBool(falsy), false);
    assert.equal(parseBool(undefined, true), true);
    assert.equal(parseBool("", true), true);
    assert.equal(parseBool("banana", false), false);
});

test("extractLicenseKey finds key-like tokens and ignores prose", () => {
    assert.equal(extractLicenseKey("here is my key: A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5"), "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5");
    assert.equal(extractLicenseKey("abc-def-123-456-7890-ABCD"), "abc-def-123-456-7890-ABCD");
    assert.equal(extractLicenseKey("just a normal sentence with no keys here"), null);
    assert.equal(extractLicenseKey(""), null);
    assert.equal(extractLicenseKey("short1"), null); // too short
    assert.equal(extractLicenseKey("AAAAAAAAAAAAAAAA"), null); // no digit
    assert.equal(extractLicenseKey("123456789012345678901234"), null); // no letter
});

test("parseMessageId accepts raw IDs and Discord links", () => {
    assert.equal(parseMessageId("123456789012345678"), "123456789012345678");
    assert.equal(parseMessageId("https://discord.com/channels/111/222/333444555666777888"), "333444555666777888");
    assert.equal(parseMessageId("  https://discord.com/channels/111/222/333444555666777888  "), "333444555666777888");
    assert.equal(parseMessageId("not an id"), null);
    assert.equal(parseMessageId(""), null);
});

test("evaluateClaimGate gates on role, linked account, and cooldown", () => {
    const base = { requireLinked: false, linked: true, requiredRoleId: null, memberRoleIds: [] };
    assert.deepEqual(evaluateClaimGate(base), { allowed: true });
    // Role required but not held
    assert.deepEqual(evaluateClaimGate({ ...base, requiredRoleId: "R1", memberRoleIds: ["R2"] }), { allowed: false, reason: "role" });
    // Role required and held
    assert.deepEqual(evaluateClaimGate({ ...base, requiredRoleId: "R1", memberRoleIds: ["R2", "R1"] }), { allowed: true });
    // Linked required but not linked
    assert.deepEqual(evaluateClaimGate({ ...base, requireLinked: true, linked: false }), { allowed: false, reason: "linked" });
    // Cooldown active
    const cooldown = evaluateClaimGate({ ...base, cooldownMs: 600_000, lastClaimAtMs: 1000, now: 200_000 });
    assert.equal(cooldown.allowed, false);
    assert.equal(cooldown.reason, "cooldown");
    assert.ok(cooldown.waitMinutes >= 1);
    // Cooldown elapsed
    assert.deepEqual(evaluateClaimGate({ ...base, cooldownMs: 600_000, lastClaimAtMs: 1000, now: 700_000 }), { allowed: true });
    // All gates pass together
    assert.deepEqual(
        evaluateClaimGate({
            ...base,
            requireLinked: true,
            linked: true,
            requiredRoleId: "R1",
            memberRoleIds: ["R1"],
            cooldownMs: 60_000,
            lastClaimAtMs: 0
        }),
        { allowed: true }
    );
});

test("launchReadinessMessage maps website reason codes", () => {
    assert.equal(launchReadinessMessage({ active: true, account: { deviceId: "x" } }), "READY TO LAUNCH");
    assert.ok(launchReadinessMessage({ active: true, account: {} }).includes("no device bound"));
    assert.ok(launchReadinessMessage({ active: false, reason: "revoked" }).includes("revoked"));
    assert.ok(launchReadinessMessage({ active: false, reason: "expired" }).includes("expired"));
    assert.ok(launchReadinessMessage({ active: false, reason: "not_linked" }).includes("not linked"));
    assert.ok(launchReadinessMessage({ active: false, reason: "something_new" }).includes("dashboard"));
});
