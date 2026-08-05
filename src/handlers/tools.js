"use strict";

const { client } = require("../client");
const { CONFIG } = require("../config");
const { nyxEmbed, errorEmbed, licenseEmbed } = require("../embeds");
const { callAuthApi } = require("../api");
const { extractLicenseKey, parseMessageId, launchReadinessMessage, licenseState } = require("../util");
const { RateLimiter } = require("../util");
const { isAdministrator } = require("../access");
const { sendAudit } = require("../audit");
const state = require("../state");
const { runtime } = require("../runtime");

// /verify hits the website per call — bound it so it cannot be spammed.
const verifyLimiter = new RateLimiter(CONFIG.PUBLIC_RATE_LIMIT_PER_MINUTE, 60_000);

// ---------------------------------------------------------------------------
// /ping — latency and uptime
// ---------------------------------------------------------------------------

async function ping(interaction) {
    const latency = client.ws.ping;
    return interaction.reply({
        embeds: [
            nyxEmbed("NYX bot").addFields(
                { name: "Gateway latency", value: `${latency} ms`, inline: true },
                { name: "Uptime", value: `<t:${Math.floor(runtime.startedAt / 1000)}:R>`, inline: true }
            )
        ],
        ephemeral: true
    });
}

// ---------------------------------------------------------------------------
// /verify — link an active license to the configured member role
// ---------------------------------------------------------------------------

async function verify(interaction) {
    if (!interaction.guildId)
        return interaction.reply({ embeds: [errorEmbed("Verification must be run inside a server.")], ephemeral: true });
    if (!CONFIG.VERIFY_ROLE_ID) {
        return interaction.reply({
            embeds: [errorEmbed("Verification is not configured. Ask an administrator to set `VERIFY_ROLE_ID`.")],
            ephemeral: true
        });
    }
    const targetUser = interaction.options.getUser("user") || interaction.user;
    if (targetUser.id !== interaction.user.id && !isAdministrator(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed("Only administrators can verify other members.")], ephemeral: true });
    }
    if (!verifyLimiter.allow(interaction.user.id)) {
        return interaction.reply({ embeds: [errorEmbed("Verification is rate-limited. Try again in a minute.")], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const member =
        targetUser.id === interaction.user.id ? interaction.member : await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.editReply({ embeds: [errorEmbed("Could not find that member in this server.")] });
    if (member.roles.cache.has(CONFIG.VERIFY_ROLE_ID)) {
        return interaction.editReply({ embeds: [nyxEmbed("Already verified", `${targetUser} already has the verified role.`)] });
    }
    const result = await callAuthApi("/api/bot/status", { discordId: targetUser.id }, { retries: 1 });
    if (!result.linked) {
        return interaction.editReply({
            embeds: [
                nyxEmbed(
                    "Verification failed",
                    `${targetUser} has not linked their Discord account yet. Sign in on the dashboard and choose **Connect Discord**, then try again.`
                )
            ]
        });
    }
    if (!result.active) {
        return interaction.editReply({ embeds: [nyxEmbed("Verification failed", launchReadinessMessage(result))] });
    }
    await member.roles.add(CONFIG.VERIFY_ROLE_ID, `NYX verified by /verify (${interaction.user.username})`);
    await sendAudit("Member verified", interaction, `${targetUser.username} (${targetUser.id}) verified`);
    return interaction.editReply({
        embeds: [nyxEmbed("Verified", `${targetUser} is verified and has been granted <@&${CONFIG.VERIFY_ROLE_ID}>.`)]
    });
}

// ---------------------------------------------------------------------------
// /verifysync — strip the verified role from inactive or unlinked members
// ---------------------------------------------------------------------------

async function runPool(items, concurrency, worker) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            await worker(item);
        }
    });
    await Promise.all(workers);
}

async function verifysync(interaction) {
    if (!interaction.guildId)
        return interaction.reply({ embeds: [errorEmbed("Verification sync must be run inside a server.")], ephemeral: true });
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    if (!CONFIG.VERIFY_ROLE_ID) {
        return interaction.reply({
            embeds: [errorEmbed("Verification is not configured. Ask an administrator to set `VERIFY_ROLE_ID`.")],
            ephemeral: true
        });
    }
    await interaction.deferReply({ ephemeral: true });
    const members = await interaction.guild.members.fetch();
    const candidates = [...members.values()]
        .filter((member) => !member.user.bot && member.roles.cache.has(CONFIG.VERIFY_ROLE_ID))
        .slice(0, 200);
    let removed = 0;
    let kept = 0;
    let failed = 0;
    await runPool(candidates, 4, async (member) => {
        try {
            const result = await callAuthApi("/api/bot/status", { discordId: member.id }, { retries: 1 });
            if (result.linked && result.active) {
                kept += 1;
            } else {
                await member.roles.remove(CONFIG.VERIFY_ROLE_ID, "NYX verification sync: license no longer active");
                removed += 1;
            }
        } catch {
            failed += 1;
        }
    });
    const summary = `Checked **${candidates.length}** verified member${candidates.length === 1 ? "" : "s"}. Removed the role from **${removed}** inactive account${removed === 1 ? "" : "s"}, kept **${kept}**, ${failed} could not be checked (API errors).`;
    await sendAudit("Verification sync", interaction, summary);
    return interaction.editReply({ embeds: [nyxEmbed("Verification sync complete", summary)] });
}

// ---------------------------------------------------------------------------
// Context menu: "Look up license" (right-click a member)
// ---------------------------------------------------------------------------

async function lookuplincense(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const result = await callAuthApi(
        "/api/bot/keys",
        { action: "lookup", query: interaction.targetUser.id, actorId: interaction.user.id },
        { retries: 1 }
    );
    if (!result.licenses.length) {
        return interaction.editReply({
            embeds: [nyxEmbed("No results", `No NYX license found for **${interaction.targetUser.username}**.`)]
        });
    }
    if (result.licenses.length === 1) {
        return interaction.editReply({ embeds: [licenseEmbed(result.licenses[0])] });
    }
    const embed = nyxEmbed(`Licenses for ${interaction.targetUser.username}`, `Found ${result.licenses.length} licenses.`);
    for (const license of result.licenses.slice(0, 5)) {
        embed.addFields({
            name: `${license.username || "Unused"} · ${licenseState(license)}`,
            value: `\`${license.keyPreview}\`\n${String(license.duration).toUpperCase()}`,
            inline: false
        });
    }
    return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Context menu: "Check license key" (right-click a message containing a key)
// ---------------------------------------------------------------------------

async function checklicensekey(interaction) {
    await interaction.deferReply({ ephemeral: true });
    // Fetch the message via REST so content is available regardless of the
    // gateway Message Content intent.
    const message = await interaction.channel?.messages?.fetch(interaction.targetId).catch(() => null);
    if (!message) return interaction.editReply({ embeds: [errorEmbed("Could not fetch that message.")] });
    const key = extractLicenseKey(message.content || "");
    if (!key) return interaction.editReply({ embeds: [errorEmbed("No license key found in that message.")] });
    const result = await callAuthApi("/api/bot/keys", { action: "search", query: key, actorId: interaction.user.id }, { retries: 1 });
    if (!result.licenses.length) return interaction.editReply({ embeds: [nyxEmbed("No results", "No license matched that key.")] });
    const embed = nyxEmbed("License key in message", `Matched \`${key.slice(0, 12)}…\``);
    for (const license of result.licenses.slice(0, 3)) {
        embed.addFields({
            name: `${license.username || "Unused"} · ${licenseState(license)}`,
            value: `\`${license.keyPreview}\`\n${license.discordUsername ? `@${license.discordUsername}` : "No Discord"} · ${String(license.duration).toUpperCase()}`,
            inline: false
        });
    }
    return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// /giveawayend — stop a giveaway early
// ---------------------------------------------------------------------------

async function giveawayend(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    const messageId = parseMessageId(interaction.options.getString("message"));
    if (!messageId) return interaction.reply({ embeds: [errorEmbed("Enter a valid giveaway message ID or link.")], ephemeral: true });
    const entry = state.getGiveaways().get(messageId);
    if (!entry) return interaction.reply({ embeds: [errorEmbed("No active giveaway found for that message.")], ephemeral: true });
    if (!entry.channelId) {
        return interaction.reply({
            embeds: [errorEmbed("This giveaway was created before channel tracking existed and cannot be ended remotely.")],
            ephemeral: true
        });
    }
    await interaction.deferReply({ ephemeral: true });
    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel?.isTextBased()) return interaction.editReply({ embeds: [errorEmbed("The giveaway channel is no longer available.")] });
    const message = await channel.messages.fetch(messageId).catch(() => null);
    const claimedText = `${entry.claimed.length} key${entry.claimed.length === 1 ? "" : "s"} claimed`;
    if (message) {
        await message
            .edit({ embeds: [nyxEmbed("NYX giveaway ended", `This giveaway has ended. **${claimedText}**.`)], components: [] })
            .catch(() => {});
    }
    state.getGiveaways().delete(messageId);
    state.queueGiveawaySave();
    await sendAudit("Giveaway ended", interaction, `${claimedText} (message ${messageId})`);
    return interaction.editReply({
        embeds: [nyxEmbed("Giveaway ended", `The giveaway was stopped and its claim button removed. ${claimedText}.`)]
    });
}

module.exports = {
    ping,
    verify,
    verifysync,
    giveawayend,
    // Context menus are dispatched by their menu name (which is not a slash
    // command name), so those keys are exported verbatim.
    "Look up license": lookuplincense,
    "Check license key": checklicensekey
};
