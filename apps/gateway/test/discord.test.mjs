import assert from "node:assert/strict";
import test from "node:test";
import { discordStatus, isAllowedDiscordMessage } from "../src/discord.mjs";

const config = { token: "token", allowedUserIds: ["user-1"], allowedChannelIds: ["channel-1"] };
const message = (overrides = {}) => ({ author: { id: "user-1", bot: false }, channel: { id: "channel-1" }, webhookId: null, ...overrides });

test("Discord is disabled until both a token and an explicit allowed user exist", () => {
  assert.equal(discordStatus({ token: "", allowedUserIds: ["user-1"], allowedChannelIds: [] }).enabled, false);
  assert.equal(discordStatus({ token: "token", allowedUserIds: [], allowedChannelIds: [] }).enabled, false);
  assert.equal(discordStatus(config).enabled, true);
});

test("Discord filters bots, webhooks, users, and channels before handling a message", () => {
  assert.equal(isAllowedDiscordMessage(message(), config), true);
  assert.equal(isAllowedDiscordMessage(message({ author: { id: "user-1", bot: true } }), config), false);
  assert.equal(isAllowedDiscordMessage(message({ webhookId: "hook" }), config), false);
  assert.equal(isAllowedDiscordMessage(message({ author: { id: "other", bot: false } }), config), false);
  assert.equal(isAllowedDiscordMessage(message({ channel: { id: "other" } }), config), false);
});
