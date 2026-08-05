"use strict";

const { commands } = require("../commands");
const account = require("./account");
const licensing = require("./licensing");
const actions = require("./actions");
const support = require("./support");

// Merge every handler module into a single commandName -> fn map. Only names
// that correspond to a registered slash command are picked up, so helper
// exports (like requestConfirmation) never leak into the router.
const commandNames = new Set(commands.map((command) => command.name));
const handlers = new Map();
for (const module of [account, licensing, actions, support]) {
    for (const [name, fn] of Object.entries(module)) {
        if (commandNames.has(name)) handlers.set(name, fn);
    }
}

module.exports = { handlers };
