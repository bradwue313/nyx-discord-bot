"use strict";

const { client } = require("./client");
const { CONFIG } = require("./config");
const { nyxEmbed } = require("./embeds");

async function sendAudit(title, interaction, details) {
    if (!CONFIG.AUDIT_LOG_CHANNEL_ID) return;
    try {
        const channel = await client.channels.fetch(CONFIG.AUDIT_LOG_CHANNEL_ID);
        if (!channel?.isTextBased()) return;
        await channel.send({
            embeds: [
                nyxEmbed(title, details).addFields(
                    { name: "Moderator", value: `${interaction.user.username} (${interaction.user.id})`, inline: false },
                    { name: "Server", value: interaction.guild?.name || "Unknown", inline: true }
                )
            ]
        });
    } catch (error) {
        console.error(`[NYX BOT] Could not write audit log: ${error.message}`);
    }
}

module.exports = { sendAudit };
