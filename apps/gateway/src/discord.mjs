import { Client, GatewayIntentBits, Partials } from "discord.js";

export function discordStatus(discord) {
  return {
    configured: Boolean(discord.token),
    enabled: Boolean(discord.token && discord.allowedUserIds.length),
    allowedUserCount: discord.allowedUserIds.length,
    allowedChannelCount: discord.allowedChannelIds.length,
  };
}

export function isAllowedDiscordMessage(message, { allowedUserIds, allowedChannelIds }) {
  if (message.author?.bot || message.webhookId) return false;
  if (!allowedUserIds.includes(message.author?.id)) return false;
  return !allowedChannelIds.length || allowedChannelIds.includes(message.channel?.id);
}

function splitMessage(content, limit = 1_900) {
  const chunks = [];
  let remaining = content.trim() || "응답을 만들지 못했습니다.";
  while (remaining.length > limit) {
    const splitAt = Math.max(remaining.lastIndexOf("\n", limit), remaining.lastIndexOf(" ", limit), limit);
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  chunks.push(remaining);
  return chunks;
}

export function startDiscordBot(discord, onMessage, logger = console) {
  const status = discordStatus(discord);
  if (!status.enabled) {
    logger.log("Discord: disabled (set FLUX_DISCORD_BOT_TOKEN and FLUX_DISCORD_ALLOWED_USER_IDS to enable it).");
    return { status: () => ({ ...status, connected: false }), stop: async () => {} };
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  let connected = false;
  client.once("ready", () => {
    connected = true;
    logger.log(`Discord: logged in as ${client.user.tag}.`);
  });
  client.on("error", (error) => logger.error(`Discord error: ${error.message}`));
  client.on("messageCreate", async (message) => {
    if (!isAllowedDiscordMessage(message, discord)) return;
    const mentioned = message.mentions.users.has(client.user?.id);
    if (message.guild && !discord.allowedChannelIds.length && !mentioned) return;
    const content = message.content.replaceAll(new RegExp(`<@!?(?:${client.user?.id})>`, "g"), "").trim();
    if (!content) return;
    try {
      await message.channel.sendTyping();
      const answer = await onMessage({ channelId: message.channel.id, userId: message.author.id, username: message.author.username, content });
      for (const part of splitMessage(answer)) await message.channel.send({ content: part, allowedMentions: { parse: [] } });
    } catch (error) {
      logger.error(`Discord message handling failed: ${error.message}`);
      await message.channel.send({ content: "FLUX가 응답을 처리하지 못했습니다. 로컬 Gateway 로그를 확인해 주세요.", allowedMentions: { parse: [] } }).catch(() => {});
    }
  });
  client.login(discord.token).catch((error) => logger.error(`Discord login failed: ${error.message}`));
  return { status: () => ({ ...status, connected }), stop: async () => client.destroy() };
}
