"use strict";

const { errorEmbed } = require("./embeds");
const { PUBLIC_COMMANDS, isAllowedGuild, logDenied } = require("./access");
const { handlers } = require("./handlers");
const { handleButton } = require("./buttons");

/**
 * Map an error to a message that is safe to show the user. Website-provided
 * messages (`friendly`) pass through; transport and unexpected errors are
 * replaced with a generic message and logged server-side only.
 */
function friendlyErrorMessage(error) {
    if (error?.name === "AbortError") return "The NYX website is waking up or did not respond in time. Try again in a moment.";
    if (error?.status === 503) return "NYX is currently in maintenance mode.";
    if (error?.status === 401 || error?.status === 403)
        return "The bot's API credentials were rejected by the website. Ask an admin to check the API secret.";
    if (error?.status && error.status >= 500) return "The NYX website returned a server error. Try again shortly.";
    if (error?.friendly) return error.message;
    console.error(`[NYX BOT] Command error: ${error?.message || error}`);
    return "Something went wrong. Try again, or ask a moderator for help.";
}

async function handleInteraction(interaction) {
    try {
        if (interaction.isButton()) return await handleButton(interaction);
        if (!interaction.isChatInputCommand()) return;
        const { commandName } = interaction;

        // --- Access gate ---------------------------------------------------
        // DMs: only public commands. Guilds: only whitelisted servers.
        if (interaction.guildId) {
            if (!isAllowedGuild(interaction.guildId)) {
                logDenied(interaction, "server not on allowlist");
                return interaction.reply({ embeds: [errorEmbed("Commands are not enabled in this server.")], ephemeral: true });
            }
        } else if (!PUBLIC_COMMANDS.has(commandName)) {
            logDenied(interaction, "sensitive command used in DMs");
            return interaction.reply({ embeds: [errorEmbed("This command must be used inside an authorized server.")], ephemeral: true });
        }

        const handler = handlers.get(commandName);
        if (!handler) {
            return interaction.reply({ embeds: [errorEmbed(`Unknown command /${commandName}.`)], ephemeral: true });
        }
        return await handler(interaction);
    } catch (error) {
        const message = friendlyErrorMessage(error);
        const payload = { embeds: [errorEmbed(message)], components: [] };
        if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
        return interaction.reply({ ...payload, ephemeral: true });
    }
}

module.exports = { handleInteraction, friendlyErrorMessage };
