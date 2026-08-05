"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { canonicalRequest, signRequest, hashBody } = require("../src/util");

test("canonicalRequest builds the documented canonical form", () => {
    const canonical = canonicalRequest("1710000000", "nonce-abc", "POST", "/api/bot/keys", "hash123");
    assert.equal(canonical, "1710000000\nnonce-abc\nPOST\n/api/bot/keys\nhash123");
});

test("signRequest is a deterministic HMAC-SHA256 over the canonical string", () => {
    const canonical = canonicalRequest("1710000000", "nonce", "POST", "/api/bot/keys", "hash");
    const signature = signRequest(canonical, "topsecret");
    const expected = crypto.createHmac("sha256", "topsecret").update(canonical).digest("base64url");
    assert.equal(signature, expected);
    // A different secret must not verify
    assert.notEqual(signature, signRequest(canonical, "othersecret"));
});

test("hashBody is a stable sha256 of the body text", () => {
    const digest = hashBody('{"a":1}');
    assert.equal(digest, crypto.createHash("sha256").update('{"a":1}').digest("base64url"));
    assert.notEqual(digest, hashBody('{"a":2}'));
});
