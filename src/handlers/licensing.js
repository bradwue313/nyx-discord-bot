"use strict";

const { client } = require("../client");
const { CONFIG } = require("../config");
const { nyxEmbed, errorEmbed, licenseEmbed, buildDailySummaryEmbed } = require("../embeds");
const { callAuthApi, fetchPublicStatus } = require("../api");
const { licenseState, RateLimiter } = require("../util");
const { isAdministrator, hasGeneratorPermission } = require("../access");
const { sendAudit } = require("../audit");
const state = require("../state");

// Limit key minting to 5 generations per user per minute to stop accidental
// or malicious flooding of the license pool.
const keygenLimiter = new RateLimiter(5, 60_000);

// ---------------------------------------------------------------------------
// /keygen — generate license keys
// ---------------------------------------------------------------------------

async function keygen(interaction) {
    if (!hasGeneratorPermission(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("You do not have permission to generate licenses.")], ephemeral: true });
    if (!keygenLimiter.allow(interaction.user.id)) {
        return interaction.reply({ embeds: [errorEmbed("Key generation is rate-limited. Try again in a minute.")], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const duration = interaction.options.getString("duration");
    const amount = interaction.options.getInteger("amount") || 1;
    const result = await callAuthApi("/api/bot/keys", {
        action: "generate",
        duration,
        amount,
        createdBy: interaction.user.username,
        actorId: interaction.user.id
    });
    const embed = nyxEmbed(
        "NYX licenses generated",
        `These complete keys are shown only in this private response.\n\n${result.keys.map((key) => `\`${key}\``).join("\n")}`
    ).addFields(
        { name: "Duration", value: duration.toUpperCase(), inline: true },
        { name: "Quantity", value: String(result.keys.length), inline: true }
    );
    await sendAudit("Licenses generated", interaction, `${result.keys.length} × ${duration}`);
    return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// /keyinfo — inspect a single license
// ---------------------------------------------------------------------------

async function keyinfo(interaction) {
    if (!hasGeneratorPermission(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("You do not have permission to inspect licenses.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const result = await callAuthApi("/api/bot/keys", {
        action: "info",
        key: interaction.options.getString("key").trim(),
        actorId: interaction.user.id
    });
    return interaction.editReply({ embeds: [licenseEmbed(result.license)] });
}

// ---------------------------------------------------------------------------
// /keys, /userlookup, /whois — search licenses
// ---------------------------------------------------------------------------

async function searchLicenses(interaction) {
    const commandName = interaction.commandName;
    if (commandName === "keys" ? !hasGeneratorPermission(interaction.member) : !isAdministrator(interaction.member)) {
        return interaction.reply({ embeds: [errorEmbed("You do not have permission to search licenses.")], ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    const query = interaction.options.getString("query").trim();
    const result = await callAuthApi("/api/bot/keys", {
        action: commandName === "keys" ? "search" : "lookup",
        query,
        actorId: interaction.user.id
    });
    if (!result.licenses.length)
        return interaction.editReply({ embeds: [nyxEmbed("No results", "No NYX accounts or licenses matched that search.")] });
    const embed = nyxEmbed("NYX search results", `Showing ${Math.min(result.licenses.length, 10)} of ${result.licenses.length} matches.`);
    for (const license of result.licenses.slice(0, 10)) {
        embed.addFields({
            name: `${license.username || "Unused"} · ${licenseState(license)}`,
            value: `\`${license.keyPreview}\`\n${license.discordUsername ? `@${license.discordUsername}` : "No Discord"} · ${String(license.duration).toUpperCase()}`,
            inline: false
        });
    }
    return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// /setgenrole — manage generator roles
// ---------------------------------------------------------------------------

async function setgenrole(interaction) {
    if (!interaction.guildId)
        return interaction.reply({ embeds: [errorEmbed("This command must be used inside a server.")], ephemeral: true });
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    const action = interaction.options.getString("action");
    const role = interaction.options.getRole("role");
    let allowedRoles = state.loadAllowedRoles(interaction.guildId);
    if (action === "list") {
        const roles = allowedRoles.length ? allowedRoles.map((id) => `<@&${id}>`).join("\n") : "No generator roles configured.";
        return interaction.reply({ embeds: [nyxEmbed("License generator roles", roles)], ephemeral: true });
    }
    if (!role) return interaction.reply({ embeds: [errorEmbed("Choose a role to add or remove.")], ephemeral: true });
    if (action === "add") allowedRoles.push(role.id);
    if (action === "remove") allowedRoles = allowedRoles.filter((id) => id !== role.id);
    state.saveAllowedRoles(interaction.guildId, allowedRoles);
    await sendAudit(
        "Generator role updated",
        interaction,
        `${action === "add" ? "Added" : "Removed"} ${role.name} in ${interaction.guild.name}`
    );
    return interaction.reply({
        embeds: [nyxEmbed("Generator role updated", `${action === "add" ? "Added" : "Removed"} <@&${role.id}>.`)],
        ephemeral: true
    });
}

// ---------------------------------------------------------------------------
// /stats — live license totals
// ---------------------------------------------------------------------------

async function stats(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const { stats: totals } = await callAuthApi("/api/bot/keys", { action: "stats", actorId: interaction.user.id });
    return interaction.editReply({
        embeds: [
            nyxEmbed("Live NYX license totals").addFields(
                { name: "Total", value: String(totals.total), inline: true },
                { name: "Active", value: String(totals.active), inline: true },
                { name: "Unused", value: String(totals.unused), inline: true },
                { name: "Paused", value: String(totals.paused), inline: true },
                { name: "Expired", value: String(totals.expired), inline: true },
                { name: "Revoked", value: String(totals.revoked), inline: true }
            )
        ]
    });
}

// ---------------------------------------------------------------------------
// /daily — daily summary
// ---------------------------------------------------------------------------

async function daily(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const embed = await buildDailySummaryEmbed(interaction.user.id);
    return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// /digest — view or publicly post the daily summary
// ---------------------------------------------------------------------------

async function digest(interaction) {
    if (!isAdministrator(interaction.member))
        return interaction.reply({ embeds: [errorEmbed("Administrator permission is required.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const embed = await buildDailySummaryEmbed(interaction.user.id);
    const postPublic = interaction.options.getBoolean("public") === true;
    if (postPublic) {
        if (!CONFIG.DIGEST_CHANNEL_ID) {
            return interaction.editReply({
                embeds: [errorEmbed("DIGEST_CHANNEL_ID is not configured. Ask an admin to set it before posting publicly.")]
            });
        }
        const channel = await client.channels.fetch(CONFIG.DIGEST_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) {
            return interaction.editReply({ embeds: [errorEmbed("DIGEST_CHANNEL_ID does not point to an available text channel.")] });
        }
        await channel.send({ embeds: [embed] });
        await sendAudit("Digest posted", interaction, `Posted daily digest to <#${CONFIG.DIGEST_CHANNEL_ID}>`);
        return interaction.editReply({ embeds: [embed, nyxEmbed("Digest posted", `Also sent to <#${CONFIG.DIGEST_CHANNEL_ID}>.`)] });
    }
    return interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// /status — live service and license metrics
// ---------------------------------------------------------------------------

async function status(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const [snapshot, metrics] = await Promise.all([
        fetchPublicStatus().catch(() => null),
        callAuthApi("/api/metrics", {}).catch(() => null)
    ]);
    if (!snapshot || !metrics)
        return interaction.editReply({ embeds: [errorEmbed("The NYX website is waking up or did not respond. Try again in a moment.")] });
    const serviceLines = (snapshot.services || []).map((service) => `**${service.label}** — ${service.status.toUpperCase()}`).join("\n");
    const embed = nyxEmbed("NYX live status")
        .addFields(
            { name: "Overall", value: snapshot.status === "operational" ? "OPERATIONAL" : "MAINTENANCE", inline: true },
            { name: "Checked", value: `<t:${snapshot.checkedAt}:R>`, inline: true }
        )
        .addFields({ name: "Services", value: serviceLines || "No services reported" })
        .addFields(
            { name: "Active licenses", value: String(metrics.metrics?.licenses?.active ?? 0), inline: true },
            { name: "Unused keys", value: String(metrics.metrics?.licenses?.unused ?? 0), inline: true },
            { name: "Live sessions", value: String(metrics.metrics?.active_sessions ?? 0), inline: true },
            { name: "Pending DMs", value: String(metrics.metrics?.pending_notifications ?? 0), inline: true },
            {
                name: "Latest build",
                value: snapshot.metrics?.clientVersion ? `v${snapshot.metrics.clientVersion}` : "Unknown",
                inline: true
            }
        );
    return interaction.editReply({ embeds: [embed] });
}

module.exports = {
    keygen,
    keyinfo,
    keys: searchLicenses,
    userlookup: searchLicenses,
    whois: searchLicenses,
    setgenrole,
    stats,
    daily,
    digest,
    status
};
