"use strict";

const { REST, Routes } = require("discord.js");
const { CONFIG } = require("./config");
const { commands } = require("./commands");
const { PUBLIC_COMMANDS } = require("./access");

const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);

/**
 * Public commands are registered globally so they work in DMs. The full
 * command set is registered per allowed guild, so non-whitelisted servers do
 * not see ~25 unusable commands in their picker. Guild commands take
 * precedence over global ones with the same name.
 */
async function registerPublicCommands() {
    const body = commands.filter((command) => PUBLIC_COMMANDS.has(command.name)).map((command) => command.toJSON());
    await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body });
    console.log(`[NYX BOT] Registered ${body.length} public (global) commands`);
}

async function registerGuildCommands(guildId) {
    if (!guildId) return;
    try {
        await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, guildId), { body: commands.map((command) => command.toJSON()) });
        console.log(`[NYX BOT] Registered ${commands.length} commands for guild ${guildId}`);
    } catch (error) {
        console.error(`[NYX BOT] Could not register commands for guild ${guildId}: ${error.message}`);
    }
}

async function registerAllGuildCommands(guildIds) {
    for (const guildId of guildIds) {
        await registerGuildCommands(guildId);
    }
}

module.exports = { registerPublicCommands, registerGuildCommands, registerAllGuildCommands };
