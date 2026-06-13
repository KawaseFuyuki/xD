const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const http = require('http');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TOKEN          = process.env.DISCORD_TOKEN;
const ADMIN_IDS      = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map(id => id.trim())
  : [];
const PORT           = process.env.PORT || 3000;
const DEFAULT_PREFIX = 'o';

// Data is saved to /data/data.json on Render (persistent disk mounted at /data)
// Falls back to the local folder if /data doesn't exist
const DATA_DIR  = fs.existsSync('/data') ? '/data' : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
// ──────────────────────────────────────────────────────────────────────────────

// ─── HTTP KEEP-ALIVE SERVER (required by Render) ──────────────────────────────
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is online!');
}).listen(PORT, () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
});
// ──────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ balances: {}, prefixes: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to load data:', e.message);
    return { balances: {}, prefixes: {} };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e.message);
  }
}

function getBalance(userId) {
  const data = loadData();
  return data.balances?.[userId] ?? 0;
}

function setBalance(userId, amount) {
  const data = loadData();
  if (!data.balances) data.balances = {};
  data.balances[userId] = Math.max(0, amount);
  saveData(data);
}

function getPrefix(guildId) {
  const data = loadData();
  return data.prefixes?.[guildId] ?? DEFAULT_PREFIX;
}

function setPrefix(guildId, prefix) {
  const data = loadData();
  if (!data.prefixes) data.prefixes = {};
  data.prefixes[guildId] = prefix;
  saveData(data);
}

function isAdmin(member) {
  if (!member) return false;
  return (
    ADMIN_IDS.includes(member.id) ||
    member.permissions.has('Administrator')
  );
}
// ──────────────────────────────────────────────────────────────────────────────

const pending = new Map();

client.once('ready', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`💾 Data saved to: ${DATA_FILE}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const PREFIX = getPrefix(message.guild.id);
  const raw    = message.content.trim();
  const lower  = raw.toLowerCase();

  // ── {prefix}cash — check own balance ──────────────────────────────────────
  if (lower === `${PREFIX.toLowerCase()}cash`) {
    if (!isAdmin(message.member)) {
      return message.reply('❌ Only admins can use this command!');
    }
    const bal = getBalance(message.author.id);
    return message.reply(
      `🏧 | **${message.author.username}**, you currently have **${bal.toLocaleString()}** cowoncy!`
    );
  }

  // All other commands need prefix + space
  if (!lower.startsWith(`${PREFIX.toLowerCase()} `)) return;

  const parts   = raw.slice(PREFIX.length).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  // ── {prefix} cash @user / {prefix} balance @user ──────────────────────────
  if (command === 'cash' || command === 'balance') {
    if (!isAdmin(message.member)) {
      return message.reply('❌ Only admins can use this command!');
    }
    const target = message.mentions.members?.first();
    if (!target) {
      return message.reply(`❌ Usage: \`${PREFIX} cash @user\``);
    }
    const bal = getBalance(target.id);
    return message.reply(
      `🏧 | **${target.user.username}** currently has **${bal.toLocaleString()}** cowoncy!`
    );
  }

  // ── {prefix} prefix {newprefix} ────────────────────────────────────────────
  if (command === 'prefix') {
    if (!isAdmin(message.member)) {
      return message.reply('❌ Only admins can use this command!');
    }
    const newPrefix = parts[1];
    if (!newPrefix || newPrefix.length > 5) {
      return message.reply(`❌ Usage: \`${PREFIX} prefix {newprefix}\` (max 5 characters)`);
    }
    setPrefix(message.guild.id, newPrefix);
    return message.reply(
      `⚙️ | **${message.author.username}**, you successfully changed my server prefix to \`${newPrefix}\`! amazing.`
    );
  }

  // ── {prefix} give @user {amount} ──────────────────────────────────────────
  if (command === 'give') {
    if (!isAdmin(message.member)) {
      return message.reply('❌ Only admins can use this command!');
    }
    const target = message.mentions.members?.first();
    const amount = parseInt(parts[2]);

    if (!target || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${PREFIX} give @user {amount}\``);
    }
    if (target.id === message.author.id) {
      return message.reply('❌ You cannot give cowoncy to yourself!');
    }
    const senderBal = getBalance(message.author.id);
    if (senderBal < amount) {
      return message.reply(
        `❌ Not enough cowoncy! Your balance: **${senderBal.toLocaleString()}**`
      );
    }

    const embed = new EmbedBuilder().setColor(0x5865f2).setDescription(
      `**${message.author.username}**, you are about to give cowoncy to **${target.user.username}**\n\n` +
      `To confirm this transaction, click ✅ Confirm.\n` +
      `To cancel this transaction, click ❌ Cancel.\n\n` +
      `⚠️ It is against our rules to trade cowoncy for anything of monetary value. ` +
      `This includes real money, crypto, nitro, or anything similar. ` +
      `You will be **banned** for doing so.\n\n` +
      `**@${message.author.username}** will give **@${target.user.username}**:\n` +
      `> ${amount.toLocaleString()} cowoncy`
    ).setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_give')
        .setLabel('✅ Confirm')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('cancel_give')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await message.reply({ embeds: [embed], components: [row] });

    pending.set(msg.id, {
      senderId:   message.author.id,
      senderName: message.author.username,
      targetId:   target.id,
      targetName: target.user.username,
      amount,
    });

    // Auto-expire after 60 seconds
    setTimeout(() => {
      if (pending.has(msg.id)) {
        pending.delete(msg.id);
        msg.edit({ components: [] }).catch(() => {});
      }
    }, 60_000);

    return;
  }

  // ── {prefix} add cash {amount} @user ──────────────────────────────────────
  if (command === 'add' && parts[1]?.toLowerCase() === 'cash') {
    if (!isAdmin(message.member)) {
      return message.reply('❌ Only admins can use this command!');
    }
    const amount = parseInt(parts[2]);
    const target =
      message.mentions.members?.first() ??
      (parts[3]
        ? message.guild.members.cache.find(
            m =>
              m.user.username.toLowerCase() === parts[3].toLowerCase() ||
              m.user.id === parts[3].replace(/[<@!>]/g, '')
          )
        : null);

    if (!target || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${PREFIX} add cash {amount} @user\``);
    }
    const newBal = getBalance(target.id) + amount;
    setBalance(target.id, newBal);
    return message.reply(
      `✅ Added **${amount.toLocaleString()}** cowoncy to **${target.user.username}**!\n` +
      `Their new balance: **${newBal.toLocaleString()}** cowoncy.`
    );
  }

  // ── {prefix} remove cash {amount} @user ───────────────────────────────────
  if (command === 'remove' && parts[1]?.toLowerCase() === 'cash') {
    if (!isAdmin(message.member)) {
      return message.reply('❌ Only admins can use this command!');
    }
    const amount = parseInt(parts[2]);
    const target =
      message.mentions.members?.first() ??
      (parts[3]
        ? message.guild.members.cache.find(
            m =>
              m.user.username.toLowerCase() === parts[3].toLowerCase() ||
              m.user.id === parts[3].replace(/[<@!>]/g, '')
          )
        : null);

    if (!target || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${PREFIX} remove cash {amount} @user\``);
    }
    const currentBal = getBalance(target.id);
    const newBal     = Math.max(0, currentBal - amount);
    setBalance(target.id, newBal);
    const removed = currentBal - newBal;
    return message.reply(
      `✅ Removed **${removed.toLocaleString()}** cowoncy from **${target.user.username}**!\n` +
      `Their new balance: **${newBal.toLocaleString()}** cowoncy.`
    );
  }
});

// ─── BUTTON INTERACTIONS ──────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const tx = pending.get(interaction.message.id);
  if (!tx) {
    return interaction.reply({ content: '⏰ This transaction has expired.', ephemeral: true });
  }
  if (interaction.user.id !== tx.senderId) {
    return interaction.reply({ content: '❌ This is not your transaction!', ephemeral: true });
  }

  if (interaction.customId === 'confirm_give') {
    const senderBal = getBalance(tx.senderId);
    if (senderBal < tx.amount) {
      pending.delete(interaction.message.id);
      await interaction.update({ components: [] });
      return interaction.followUp('❌ You no longer have enough cowoncy!');
    }
    setBalance(tx.senderId, senderBal - tx.amount);
    setBalance(tx.targetId, getBalance(tx.targetId) + tx.amount);
    pending.delete(interaction.message.id);
    await interaction.update({ components: [] });
    return interaction.followUp(
      `🏧 | **@${tx.senderName}** sent **${tx.amount.toLocaleString()}** cowoncy to **@${tx.targetName}**!`
    );
  }

  if (interaction.customId === 'cancel_give') {
    pending.delete(interaction.message.id);
    await interaction.update({ components: [] });
    return interaction.followUp('❌ Transaction cancelled.');
  }
});

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
client.on('error', err => console.error('Discord client error:', err.message));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

client.login(TOKEN);
