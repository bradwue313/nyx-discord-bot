"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { client } = require("./client");
const { CONFIG } = require("./config");
const { callAuthApi } = require("./api");
const { nyxEmbed, errorEmbed } = require("./embeds");
const state = require("./state");

function giveawayRow(id) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nyx_giveaway:${id}`).setLabel("Claim a key").setStyle(ButtonStyle.Primary)
    );
}

async function loadGiveawayStateFromWebsite() {
    try {
        const response = await fetch(`${CONFIG.AUTH_URL}/api/bot/giveaways`, {
            headers: {
                Authorization: `Bearer ${CONFIG.API_SECRET}`,
                Accept: "application/json"
            },
            signal: AbortSignal.timeout(15_000)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) return;
        if (payload.giveaways && typeof payload.giveaways === "object" && !Array.isArray(payload.giveaways)) {
            state.setGiveawaysFromWebsite(payload.giveaways);
        }
        if (payload.cooldowns && typeof payload.cooldowns === "object" && !Array.isArray(payload.cooldowns)) {
            state.setLastGiveawayAtFromWebsite(payload.cooldowns);
        }
    } catch (error) {
        console.error(`[NYX BOT] Could not load giveaways from website: ${error.message}`);
    }
}

async function handleGiveawayClaim(interaction, messageId) {
    const giveaway = state.getGiveaways().get(messageId);
    if (!giveaway) {
        return interaction.reply({ embeds: [errorEmbed("This giveaway no longer exists.")], ephemeral: true });
    }
    const userId = interaction.user.id;
    if (giveaway.claimed.includes(userId)) {
        return interaction.reply({ embeds: [errorEmbed("You already claimed a key from this giveaway.")], ephemeral: true });
    }
    const nextKey = giveaway.keys.shift();
    if (!nextKey) {
        return interaction.reply({ embeds: [errorEmbed("All giveaway keys have been claimed.")], ephemeral: true });
    }
    giveaway.claimed.push(userId);
    try {
        await interaction.user.send({
            embeds: [
                nyxEmbed(
                    "Your NYX giveaway key",
                    `Your **${giveaway.duration.toUpperCase()}** license:\n\n\`${nextKey}\`\n\nActivate it on the dashboard: ${CONFIG.AUTH_URL}/register?key=${nextKey}`
                )
            ]
        });
    } catch (error) {
        giveaway.keys.unshift(nextKey);
        giveaway.claimed.pop();
        return interaction.reply({
            embeds: [errorEmbed("Could not DM you. Enable DMs from server members and try again.")],
            ephemeral: true
        });
    }
    const remaining = giveaway.keys.length;
    state.queueGiveawaySave();
    await interaction.reply({
        embeds: [
            nyxEmbed(
                "Key claimed!",
                `A **${giveaway.duration.toUpperCase()}** license was DM'd to you. ${remaining} key${remaining === 1 ? "" : "s"} left.`
            )
        ],
        ephemeral: true
    });
    try {
        const message = await interaction.channel?.messages?.fetch(messageId).catch(() => null);
        if (message) {
            await message.edit({
                embeds: [
                    nyxEmbed(
                        "NYX key giveaway",
                        `React below to claim a **${giveaway.duration.toUpperCase()}** license key.\n\n**Remaining: ${remaining}**`
                    )
                ],
                components: remaining > 0 ? [giveawayRow(messageId)] : []
            });
        }
    } catch {
        /* message may have been deleted */
    }
}

async function postAutoGiveaway() {
    if (!client.isReady()) return;
    try {
        const channel = await client.channels.fetch(CONFIG.GIVEAWAY_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) {
            console.error(`[NYX BOT] Auto-giveaway channel ${CONFIG.GIVEAWAY_CHANNEL_ID} is not available`);
            return;
        }
        const count = CONFIG.GIVEAWAY_AUTO_COUNT;
        const result = await callAuthApi("/api/bot/keys", {
            action: "generate",
            duration: CONFIG.GIVEAWAY_AUTO_DURATION,
            amount: count,
            createdBy: "auto-giveaway",
            actorId: "auto-giveaway"
        });
        const message = await channel.send({
            embeds: [
                nyxEmbed(
                    "NYX key giveaway",
                    `Claim a **${CONFIG.GIVEAWAY_AUTO_DURATION.toUpperCase()}** license key below. **${result.keys.length}** available — first come, first served. Keys are delivered by DM.`
                )
            ],
            components: [giveawayRow("pending")]
        });
        state.getGiveaways().set(message.id, { keys: result.keys, claimed: [], duration: CONFIG.GIVEAWAY_AUTO_DURATION });
        state.queueGiveawaySave();
        await message.edit({ components: [giveawayRow(message.id)] });
        console.log(
            `[NYX BOT] Auto-giveaway posted ${result.keys.length} × ${CONFIG.GIVEAWAY_AUTO_DURATION} in ${CONFIG.GIVEAWAY_CHANNEL_ID}`
        );
    } catch (error) {
        console.error(`[NYX BOT] Auto-giveaway failed: ${error.message}`);
    }
}

function startAutoGiveaway() {
    if (!CONFIG.GIVEAWAY_CHANNEL_ID || CONFIG.GIVEAWAY_AUTO_INTERVAL_HOURS <= 0) return;
    const intervalMs = CONFIG.GIVEAWAY_AUTO_INTERVAL_HOURS * 60 * 60 * 1000;
    console.log(`[NYX BOT] Auto-giveaway scheduled every ${CONFIG.GIVEAWAY_AUTO_INTERVAL_HOURS}h in channel ${CONFIG.GIVEAWAY_CHANNEL_ID}`);
    setInterval(postAutoGiveaway, intervalMs).unref();
}

module.exports = { giveawayRow, loadGiveawayStateFromWebsite, handleGiveawayClaim, postAutoGiveaway, startAutoGiveaway };
