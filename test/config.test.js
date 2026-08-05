"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseConfig } = require("../src/config");

function baseEnv() {
    return {
        BOT_TOKEN: "token",
        CLIENT_ID: "123",
        NYX_AUTH_URL: "https://nyx.example.com/",
        BOT_API_SECRET: "secret"
    };
}

test("parseConfig normalizes AUTH_URL (strips trailing slash)", () => {
    const config = parseConfig(baseEnv());
    assert.equal(config.AUTH_URL, "https://nyx.example.com");
});

test("parseConfig parses CSV lists and defaults", () => {
    const config = parseConfig({ ...baseEnv(), ALLOWED_GUILD_IDS: " 111, 222 ,, ", BOT_OWNER_IDS: "42" });
    assert.deepEqual(config.ALLOWED_GUILD_IDS, ["111", "222"]);
    assert.deepEqual(config.BOT_OWNER_IDS, ["42"]);
    assert.equal(config.GIVEAWAY_MAX_KEYS, 10);
    assert.equal(config.GIVEAWAY_AUTO_COUNT, 3);
});

test("parseConfig clamps giveaway values", () => {
    const config = parseConfig({ ...baseEnv(), GIVEAWAY_MAX_KEYS: "999", GIVEAWAY_COOLDOWN_MINUTES: "-5", GIVEAWAY_AUTO_COUNT: "0" });
    assert.equal(config.GIVEAWAY_MAX_KEYS, 25);
    assert.equal(config.GIVEAWAY_COOLDOWN_MINUTES, 0);
    assert.equal(config.GIVEAWAY_AUTO_COUNT, 1);
});

test("parseConfig keeps optional ids as strings", () => {
    const config = parseConfig({ ...baseEnv(), TICKET_CATEGORY_ID: "cat1", DIGEST_CHANNEL_ID: "chan1", DIGEST_TIME: "09:30" });
    assert.equal(config.TICKET_CATEGORY_ID, "cat1");
    assert.equal(config.DIGEST_CHANNEL_ID, "chan1");
    assert.equal(config.DIGEST_TIME, "09:30");
});

test("parseConfig parses verification and giveaway gating", () => {
    const config = parseConfig({
        ...baseEnv(),
        VERIFY_ROLE_ID: "role1",
        GIVEAWAY_REQUIRED_ROLE_ID: "role2",
        GIVEAWAY_REQUIRE_LINKED: "true",
        GIVEAWAY_CLAIM_COOLDOWN_MINUTES: "45",
        TICKET_TRANSCRIPT_CHANNEL_ID: "chan9",
        PUBLIC_RATE_LIMIT_PER_MINUTE: "25"
    });
    assert.equal(config.VERIFY_ROLE_ID, "role1");
    assert.equal(config.GIVEAWAY_REQUIRED_ROLE_ID, "role2");
    assert.equal(config.GIVEAWAY_REQUIRE_LINKED, true);
    assert.equal(config.GIVEAWAY_CLAIM_COOLDOWN_MINUTES, 45);
    assert.equal(config.TICKET_TRANSCRIPT_CHANNEL_ID, "chan9");
    assert.equal(config.PUBLIC_RATE_LIMIT_PER_MINUTE, 25);
});

test("parseConfig defaults gating and clamps the public rate limit", () => {
    const config = parseConfig(baseEnv());
    assert.equal(config.GIVEAWAY_REQUIRE_LINKED, false);
    assert.equal(config.GIVEAWAY_CLAIM_COOLDOWN_MINUTES, 0);
    assert.equal(config.PUBLIC_RATE_LIMIT_PER_MINUTE, 10);
    const clamped = parseConfig({ ...baseEnv(), PUBLIC_RATE_LIMIT_PER_MINUTE: "999", GIVEAWAY_CLAIM_COOLDOWN_MINUTES: "-1" });
    assert.equal(clamped.PUBLIC_RATE_LIMIT_PER_MINUTE, 120);
    assert.equal(clamped.GIVEAWAY_CLAIM_COOLDOWN_MINUTES, 0);
});
