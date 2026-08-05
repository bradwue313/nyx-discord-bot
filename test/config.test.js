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
