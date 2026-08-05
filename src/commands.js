"use strict";

const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");

const durations = [
    { name: "12 Hours", value: "12h" },
    { name: "1 Day", value: "1d" },
    { name: "1 Week", value: "1w" },
    { name: "1 Month", value: "1m" },
    { name: "1 Year", value: "1y" },
    { name: "Lifetime", value: "lifetime" }
];

const commands = [
    new SlashCommandBuilder().setName("panel").setDescription("Open your NYX account and support controls"),
    new SlashCommandBuilder().setName("help").setDescription("Show NYX bot commands and account setup"),
    new SlashCommandBuilder().setName("setup").setDescription("Open the guided NYX account setup checklist"),
    new SlashCommandBuilder().setName("privacy").setDescription("See how NYX protects account and diagnostic information"),
    new SlashCommandBuilder()
        .setName("keygen")
        .setDescription("Generate NYX website license keys")
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("License duration after activation")
                .setRequired(true)
                .addChoices(...durations)
        )
        .addIntegerOption((option) =>
            option.setName("amount").setDescription("Number of keys, from 1 to 10").setMinValue(1).setMaxValue(10)
        ),
    new SlashCommandBuilder()
        .setName("setgenrole")
        .setDescription("Manage roles allowed to generate keys")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName("action")
                .setDescription("Role action")
                .setRequired(true)
                .addChoices(
                    { name: "Add Role", value: "add" },
                    { name: "Remove Role", value: "remove" },
                    { name: "List Allowed Roles", value: "list" }
                )
        )
        .addRoleOption((option) => option.setName("role").setDescription("Role to add or remove")),
    new SlashCommandBuilder()
        .setName("keyinfo")
        .setDescription("Check a NYX license")
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true)),
    new SlashCommandBuilder()
        .setName("keys")
        .setDescription("Search recent NYX licenses")
        .addStringOption((option) => option.setName("query").setDescription("Username, email, Discord, or key preview").setRequired(true)),
    new SlashCommandBuilder()
        .setName("userlookup")
        .setDescription("Find a NYX account and license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName("query").setDescription("Username, email, Discord ID, or Discord username").setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("whois")
        .setDescription("Find a NYX account and license (alias for /userlookup)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option.setName("query").setDescription("Username, email, Discord ID, or Discord username").setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("notifyall")
        .setDescription("Send an announcement DM to every account with release alerts enabled")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("message").setDescription("Announcement text").setRequired(true).setMaxLength(500)),
    new SlashCommandBuilder()
        .setName("notifyuser")
        .setDescription("Queue a DM notification for a linked Discord user")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("userid").setDescription("Discord user ID").setRequired(true))
        .addStringOption((option) => option.setName("message").setDescription("Notification text").setRequired(true).setMaxLength(500)),
    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Show live NYX license totals")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName("health").setDescription("Check the NYX website and authorization service"),
    ...[
        ["keyrevoke", "Revoke a NYX license"],
        ["keyreset", "Reset the device attached to a NYX license"],
        ["keypause", "Temporarily pause a NYX license"],
        ["keyresume", "Resume a paused NYX license"]
    ].map(([name, description]) =>
        new SlashCommandBuilder()
            .setName(name)
            .setDescription(description)
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true))
    ),
    new SlashCommandBuilder()
        .setName("keyextend")
        .setDescription("Replace the expiration period for a NYX license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true))
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("New duration from now")
                .setRequired(true)
                .addChoices(...durations)
        ),
    new SlashCommandBuilder()
        .setName("keynote")
        .setDescription("Attach a private note to a NYX license")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX key").setRequired(true))
        .addStringOption((option) =>
            option.setName("note").setDescription("Private note, or blank text to replace it").setRequired(true).setMaxLength(300)
        ),
    new SlashCommandBuilder().setName("mystatus").setDescription("Check whether your Discord is linked to an active NYX account"),
    new SlashCommandBuilder()
        .setName("redeem")
        .setDescription("Check a license key and get your registration link")
        .addStringOption((option) => option.setName("key").setDescription("Complete NYX license key").setRequired(true)),
    new SlashCommandBuilder().setName("download").setDescription("Get the NYX client download link and latest version"),
    new SlashCommandBuilder().setName("link").setDescription("Learn how to link your Discord account to NYX"),
    new SlashCommandBuilder()
        .setName("daily")
        .setDescription("Daily license summary (administrators)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName("digest")
        .setDescription("Post or view the daily license digest (administrators)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addBooleanOption((option) => option.setName("public").setDescription("Also post the digest to DIGEST_CHANNEL_ID")),
    new SlashCommandBuilder().setName("ticket").setDescription("Open a private support ticket channel"),
    new SlashCommandBuilder().setName("status").setDescription("Show live NYX service and license metrics"),
    new SlashCommandBuilder()
        .setName("giveaway")
        .setDescription("Drop giveaway license keys with a claim button")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription("License duration")
                .setRequired(true)
                .addChoices(...durations)
        )
        .addIntegerOption((option) =>
            option.setName("count").setDescription("Number of keys, from 1 to 10").setMinValue(1).setMaxValue(10)
        ),
    new SlashCommandBuilder()
        .setName("owner")
        .setDescription("Manage the server allowlist (owner only)")
        .addStringOption((option) =>
            option
                .setName("action")
                .setDescription("Allowlist action")
                .setRequired(true)
                .addChoices(
                    { name: "Allow Server", value: "allow" },
                    { name: "Deny Server", value: "deny" },
                    { name: "List Allowed Servers", value: "list" }
                )
        )
        .addStringOption((option) => option.setName("serverid").setDescription("Guild ID to allow or deny"))
];

module.exports = { commands, durations };
