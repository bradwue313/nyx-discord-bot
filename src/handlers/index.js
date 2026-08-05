"use strict";

const { commands, contextMenus } = require("../commands");
const account = require("./account");
const licensing = require("./licensing");
const actions = require("./actions");
const support = require("./support");
const tools = require("./tools");

// Merge every handler module into a single name -> fn map. Only names that
// correspond to a registered slash command or context menu are picked up, so
// helper exports (like requestConfirmation) never leak into the router.
const registeredNames = new Set([...commands.map((command) => command.name), ...contextMenus.map((menu) => menu.name)]);
const handlers = new Map();
for (const module of [account, licensing, actions, support, tools]) {
    for (const [name, fn] of Object.entries(module)) {
        if (registeredNames.has(name)) handlers.set(name, fn);
    }
}

module.exports = { handlers };
