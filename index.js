const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    TOKEN: process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE',
    CLIENT_ID: process.env.CLIENT_ID || '1532620882969890826',
    PORT: process.env.PORT || 3000,
    KEYS_FILE: path.join(__dirname, 'keys.json'),
    ALLOWED_ROLES_FILE: path.join(__dirname, 'allowed_roles.json')
};

// Ensure database files exist
if (!fs.existsSync(CONFIG.KEYS_FILE)) {
    fs.writeFileSync(CONFIG.KEYS_FILE, JSON.stringify({}, null, 4));
}
if (!fs.existsSync(CONFIG.ALLOWED_ROLES_FILE)) {
    fs.writeFileSync(CONFIG.ALLOWED_ROLES_FILE, JSON.stringify([], null, 4));
}

function loadKeys() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG.KEYS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveKeys(data) {
    fs.writeFileSync(CONFIG.KEYS_FILE, JSON.stringify(data, null, 4));
}

function loadAllowedRoles() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG.ALLOWED_ROLES_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveAllowedRoles(roles) {
    fs.writeFileSync(CONFIG.ALLOWED_ROLES_FILE, JSON.stringify(roles, null, 4));
}

function hasGenPermission(member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const allowedRoles = loadAllowedRoles();
    if (allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

// Generate key formatted as NYX-XXXX-XXXX-XXXX
function generateNYXKey() {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part3 = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `NYX-${part1}-${part2}-${part3}`;
}

function getExpiryTimestamp(duration) {
    const now = Date.now();
    switch (duration) {
        case '12h': return now + (12 * 60 * 60 * 1000);
        case '1d':  return now + (24 * 60 * 60 * 1000);
        case '1w':  return now + (7 * 24 * 60 * 60 * 1000);
        case '1m':  return now + (30 * 24 * 60 * 60 * 1000);
        case '1y':  return now + (365 * 24 * 60 * 60 * 1000);
        case 'lifetime': return -1;
        default: return now + (24 * 60 * 60 * 1000);
    }
}

// ==========================================
// DISCORD BOT CLIENT
// ==========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const commands = [
    new SlashCommandBuilder()
        .setName('keygen')
        .setDescription('Generate NYX License Keys')
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Select key validity duration')
                .setRequired(true)
                .addChoices(
                    { name: '12 Hours', value: '12h' },
                    { name: '1 Day', value: '1d' },
                    { name: '1 Week', value: '1w' },
                    { name: '1 Month', value: '1m' },
                    { name: '1 Year', value: '1y' },
                    { name: 'Lifetime', value: 'lifetime' }
                ))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of keys to generate (1-10)')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('setgenrole')
        .setDescription('Add or remove a role allowed to generate keys')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Add or remove role')
                .setRequired(true)
                .addChoices(
                    { name: 'Add Role', value: 'add' },
                    { name: 'Remove Role', value: 'remove' },
                    { name: 'List Allowed Roles', value: 'list' }
                ))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to allow/deny')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('keyinfo')
        .setDescription('Check details of a NYX key')
        .addStringOption(option =>
            option.setName('key')
                .setDescription('The key to check (NYX-XXXX-XXXX-XXXX)')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('keyrevoke')
        .setDescription('Revoke/Delete a NYX key')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('key')
                .setDescription('The key to revoke')
                .setRequired(true))
];

client.on('ready', async () => {
    console.log(`[NYX BOT] Logged in as ${client.user.tag}`);
    
    if (CONFIG.TOKEN !== 'YOUR_BOT_TOKEN_HERE' && CONFIG.CLIENT_ID !== 'YOUR_CLIENT_ID_HERE') {
        try {
            const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
            await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
            console.log('[NYX BOT] Slash commands registered successfully.');
        } catch (err) {
            console.error('[NYX BOT] Error registering commands:', err.message);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member } = interaction;

    if (commandName === 'setgenrole') {
        const action = interaction.options.getString('action');
        const role = interaction.options.getRole('role');
        let allowedRoles = loadAllowedRoles();

        if (action === 'list') {
            if (allowedRoles.length === 0) {
                return interaction.reply({ content: 'ℹ️ No generator roles set. Only Administrators can run `/keygen`.', ephemeral: true });
            }
            const roleList = allowedRoles.map(id => `<@&${id}>`).join(', ');
            return interaction.reply({ content: `📋 **Roles allowed to run \`/keygen\`**: ${roleList}`, ephemeral: true });
        }

        if (!role) {
            return interaction.reply({ content: '❌ Please select a role.', ephemeral: true });
        }

        if (action === 'add') {
            if (!allowedRoles.includes(role.id)) {
                allowedRoles.push(role.id);
                saveAllowedRoles(allowedRoles);
            }
            return interaction.reply({ content: `✅ Added <@&${role.id}> to key generator roles.`, ephemeral: true });
        }

        if (action === 'remove') {
            allowedRoles = allowedRoles.filter(id => id !== role.id);
            saveAllowedRoles(allowedRoles);
            return interaction.reply({ content: `✅ Removed <@&${role.id}> from key generator roles.`, ephemeral: true });
        }
    }

    if (commandName === 'keygen') {
        if (!hasGenPermission(member)) {
            return interaction.reply({ content: '❌ You do not have permission to run `/keygen`.', ephemeral: true });
        }

        const duration = interaction.options.getString('duration');
        const amount = Math.min(Math.max(interaction.options.getInteger('amount') || 1, 1), 10);

        const keysDB = loadKeys();
        const generatedKeys = [];

        for (let i = 0; i < amount; i++) {
            const key = generateNYXKey();
            const expiresAt = getExpiryTimestamp(duration);

            keysDB[key] = {
                duration: duration,
                created_by: interaction.user.tag,
                created_at: Date.now(),
                expires_at: expiresAt,
                hwid: null,
                used: false
            };
            generatedKeys.push(key);
        }

        saveKeys(keysDB);

        const embed = new EmbedBuilder()
            .setTitle('🔑 NYX License Key Generated')
            .setColor('#FFFFFF')
            .addFields(
                { name: 'Keys Generated', value: `\`\`\`${generatedKeys.join('\n')}\`\`\`` },
                { name: 'Duration', value: duration.toUpperCase(), inline: true },
                { name: 'Quantity', value: `${amount}`, inline: true },
                { name: 'Created By', value: interaction.user.tag, inline: true }
            )
            .setFooter({ text: 'NYX External Auth System' });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'keyinfo') {
        if (!hasGenPermission(member)) {
            return interaction.reply({ content: '❌ You do not have permission to check key info.', ephemeral: true });
        }

        const key = interaction.options.getString('key').trim();
        const keysDB = loadKeys();
        const info = keysDB[key];

        if (!info) {
            return interaction.reply({ content: `❌ Key \`${key}\` not found in database.`, ephemeral: true });
        }

        const expStr = info.expires_at === -1 ? 'Lifetime' : new Date(info.expires_at).toUTCString();

        const embed = new EmbedBuilder()
            .setTitle(`Key Info: ${key}`)
            .setColor('#00FF88')
            .addFields(
                { name: 'Duration', value: info.duration.toUpperCase(), inline: true },
                { name: 'Status', value: info.used ? 'Activated' : 'Unused', inline: true },
                { name: 'Expires At', value: expStr, inline: true },
                { name: 'HWID Bound', value: info.hwid ? `\`${info.hwid}\`` : 'None (Unbound)', inline: false },
                { name: 'Created By', value: info.created_by, inline: true }
            );

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'keyrevoke') {
        const key = interaction.options.getString('key').trim();
        const keysDB = loadKeys();

        if (!keysDB[key]) {
            return interaction.reply({ content: `❌ Key \`${key}\` does not exist.`, ephemeral: true });
        }

        delete keysDB[key];
        saveKeys(keysDB);

        await interaction.reply({ content: `✅ Key \`${key}\` has been revoked.`, ephemeral: true });
    }
});

// ==========================================
// EXPRESS KEY AUTH API FOR NYX.EXE
// ==========================================
const app = express();
app.use(express.json());

app.post('/api/verify', (req, res) => {
    const { key, hwid } = req.body;

    if (!key) {
        return res.status(400).json({ success: false, message: 'Missing key parameter' });
    }

    const keysDB = loadKeys();
    const keyData = keysDB[key];

    if (!keyData) {
        return res.status(400).json({ success: false, message: 'Invalid or non-existent key' });
    }

    if (keyData.expires_at !== -1 && Date.now() > keyData.expires_at) {
        return res.status(400).json({ success: false, message: 'Key has expired' });
    }

    if (!keyData.hwid) {
        keyData.hwid = hwid || 'GENERATED_HWID';
        keyData.used = true;
        saveKeys(keysDB);
    } else if (hwid && keyData.hwid !== hwid) {
        return res.status(400).json({ success: false, message: 'HWID mismatch. Reset required.' });
    }

    return res.json({
        success: true,
        message: 'License verified successfully',
        duration: keyData.duration,
        expires_at: keyData.expires_at
    });
});

app.listen(CONFIG.PORT, () => {
    console.log(`[NYX API] Server running on port ${CONFIG.PORT}`);
});

if (CONFIG.TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
    client.login(CONFIG.TOKEN);
} else {
    console.log('[NYX BOT] Please configure your BOT_TOKEN in CONFIG or environment variables.');
}
