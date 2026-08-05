"use strict";

const { CONFIG, validateConfig } = require("./config");
const { client } = require("./client");
const { runtime } = require("./runtime");
const { commands } = require("./commands");
const state = require("./state");
const { startPolls } = require("./polls");
const { loadGiveawayStateFromWebsite, startAutoGiveaway } = require("./giveaways");
const { registerPublicCommands, registerAllGuildCommands, registerGuildCommands } = require("./registration");
const { buildDailySummaryEmbed } = require("./embeds");
const { callAuthApi } = require("./api");
const { handleInteraction } = require("./router");

validateConfig();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

client.once("ready", async () => {
    runtime.startedAt = Date.now();
    console.log(`[NYX BOT] Logged in as ${client.user.username}`);
    client.user.setPresence({ activities: [{ name: "NYX authorization" }], status: "online" });

    try {
        await registerPublicCommands();
        await registerAllGuildCommands(state.getAllowedServers());
        console.log(`[NYX BOT] Registered ${commands.length} commands`);
    } catch (error) {
        console.error(`[NYX BOT] Command registration failed: ${error.message}`);
    }

    console.log(
        `[NYX BOT] Server allowlist: ${state.getAllowedServers().size ? [...state.getAllowedServers()].join(", ") : "NONE (fail-closed; add via ALLOWED_GUILD_IDS or /owner allow)"}`
    );
    console.log(`[NYX BOT] Owners: ${CONFIG.BOT_OWNER_IDS.length ? CONFIG.BOT_OWNER_IDS.join(", ") : "none configured"}`);

    await loadGiveawayStateFromWebsite();

    // Leave any server the bot is in that is not on the allowlist.
    for (const guild of client.guilds.cache.values()) {
        if (!state.isAllowedGuild(guild.id)) {
            console.warn(`[NYX BOT] Leaving non-whitelisted guild ${guild.id} (${guild.name})`);
            await guild.leave().catch((error) => console.error(`[NYX BOT] Could not leave ${guild.id}: ${error.message}`));
        }
    }

    startPolls();
    startAutoGiveaway();
    startDigest();
    setInterval(state.pruneSessions, 60_000).unref();
});

// Auto-leave if the bot is added to a server that is not on the allowlist;
// whitelisted servers get their guild command set registered immediately.
// Auto-verify: if a verification role is configured and the joining member's
// Discord is linked to an active license, grant the role immediately.
client.on("guildMemberAdd", async (member) => {
    if (member.user.bot) return;
    if (!state.isAllowedGuild(member.guild.id)) return;
    if (!CONFIG.VERIFY_ROLE_ID) return;
    try {
        const result = await callAuthApi("/api/bot/status", { discordId: member.id }, { retries: 1 });
        if (result.linked && result.active) {
            await member.roles.add(CONFIG.VERIFY_ROLE_ID, "NYX auto-verify on join");
            console.log(`[NYX BOT] Auto-verified ${member.user.username} (${member.id}) on join`);
        }
    } catch (error) {
        console.error(`[NYX BOT] Auto-verify failed for ${member.id}: ${error.message}`);
    }
});

client.on("guildCreate", async (guild) => {
    if (state.isAllowedGuild(guild.id)) {
        console.log(`[NYX BOT] Added to whitelisted guild ${guild.id} (${guild.name})`);
        await registerGuildCommands(guild.id);
        return;
    }
    console.warn(`[NYX BOT] Leaving newly-added non-whitelisted guild ${guild.id} (${guild.name})`);
    guild.leave().catch((error) => console.error(`[NYX BOT] Could not leave ${guild.id}: ${error.message}`));
});

client.on("interactionCreate", (interaction) => {
    handleInteraction(interaction).catch((error) => console.error(`[NYX BOT] Unhandled interaction error: ${error?.message || error}`));
});

// ---------------------------------------------------------------------------
// Scheduled digest: daily at DIGEST_TIME (HH:MM UTC) when set, otherwise every
// DIGEST_INTERVAL_HOURS hours.
// ---------------------------------------------------------------------------

function startDigest() {
    if (!CONFIG.DIGEST_CHANNEL_ID) return;
    const postDigest = async () => {
        if (!client.isReady()) return;
        try {
            const channel = await client.channels.fetch(CONFIG.DIGEST_CHANNEL_ID).catch(() => null);
            if (!channel?.isTextBased()) {
                console.error(`[NYX BOT] Digest channel ${CONFIG.DIGEST_CHANNEL_ID} is not available`);
                return;
            }
            const embed = await buildDailySummaryEmbed("scheduled-digest");
            await channel.send({ embeds: [embed] });
            console.log(`[NYX BOT] Scheduled digest posted to ${CONFIG.DIGEST_CHANNEL_ID}`);
        } catch (error) {
            console.error(`[NYX BOT] Scheduled digest failed: ${error.message}`);
        }
    };
    if (CONFIG.DIGEST_TIME) {
        const [hours, minutes] = CONFIG.DIGEST_TIME.split(":").map(Number);
        const scheduleNext = () => {
            const next = new Date();
            next.setUTCHours(hours, minutes, 0, 0);
            if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
            setTimeout(() => {
                postDigest().finally(scheduleNext);
            }, next.getTime() - Date.now()).unref();
        };
        console.log(`[NYX BOT] Digest scheduled daily at ${CONFIG.DIGEST_TIME} UTC in channel ${CONFIG.DIGEST_CHANNEL_ID}`);
        scheduleNext();
    } else if (CONFIG.DIGEST_INTERVAL_HOURS > 0) {
        const intervalMs = CONFIG.DIGEST_INTERVAL_HOURS * 60 * 60 * 1000;
        console.log(`[NYX BOT] Digest scheduled every ${CONFIG.DIGEST_INTERVAL_HOURS}h in channel ${CONFIG.DIGEST_CHANNEL_ID}`);
        setInterval(postDigest, intervalMs).unref();
    }
}

// ---------------------------------------------------------------------------
// Shutdown: flush persisted state before exiting so restarts do not lose
// giveaway keys or cooldowns.
// ---------------------------------------------------------------------------

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[NYX BOT] ${signal} received, flushing state and disconnecting...`);
    try {
        state.flushGiveawaysLocal();
    } catch (error) {
        console.error(`[NYX BOT] Could not flush giveaway state: ${error.message}`);
    }
    try {
        client.destroy();
    } catch {
        /* ignore */
    }
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => console.error("[NYX BOT] Unhandled error:", error?.message || error));

client.login(CONFIG.TOKEN);
