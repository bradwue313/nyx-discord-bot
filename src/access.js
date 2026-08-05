"use strict";

const { PermissionFlagsBits } = require("discord.js");
const { CONFIG } = require("./config");
const state = require("./state");

// Public commands that are safe to run in DMs or non-whitelisted servers.
const PUBLIC_COMMANDS = new Set(["panel", "help", "health", "mystatus", "download", "link", "setup", "privacy"]);

function isAllowedGuild(guildId) {
    return state.isAllowedGuild(guildId);
}

function isBotOwner(userId) {
    return Boolean(userId && CONFIG.BOT_OWNER_IDS.includes(userId));
}

function isAdministrator(member) {
    return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function hasGeneratorPermission(member) {
    if (isAdministrator(member)) return true;
    const guildId = member?.guild?.id;
    if (!guildId) return false;
    const allowedRoles = state.loadAllowedRoles(guildId);
    return allowedRoles.length > 0 && member?.roles?.cache?.some((role) => allowedRoles.includes(role.id));
}

function logDenied(interaction, reason) {
    const where = interaction.guild ? `guild=${interaction.guild.id} (${interaction.guild.name})` : "dm";
    const actor = `${interaction.user.username} (${interaction.user.id})`;
    const command = interaction.isChatInputCommand() ? `/${interaction.commandName}` : `button:${interaction.customId}`;
    console.warn(`[NYX BOT] DENIED ${command} by ${actor} in ${where}: ${reason}`);
}

module.exports = { PUBLIC_COMMANDS, isAllowedGuild, isBotOwner, isAdministrator, hasGeneratorPermission, logDenied };
