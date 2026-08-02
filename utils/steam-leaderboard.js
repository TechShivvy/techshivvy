#!/usr/bin/env node
// Fetches Steam playtime/recent-games data and writes an aligned leaderboard
// into README.md between the steam-box marker pairs. Self-hosted: no
// dependency on external steam-box binaries or actions.

const fs = require("fs");

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = process.env.STEAM_ID;
const MARKDOWN_FILE = process.env.MARKDOWN_FILE || "README.md";

if (!STEAM_API_KEY || !STEAM_ID) {
  console.error("STEAM_API_KEY and STEAM_ID are required");
  process.exit(1);
}

const EMOJI = {
  271590: "🚓 ", // Grand Theft Auto V Legacy
  3240220: "🚓 ", // Grand Theft Auto V Enhanced
};
const DEFAULT_EMOJI = "🎮 ";

function emojiFor(appid) {
  return EMOJI[appid] || DEFAULT_EMOJI;
}

function fmtTime(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hrs} hrs ${mins} mins`;
}

// Display width used for column alignment: emoji/symbols count as 2 cells,
// everything else as 1. Variation selectors and ZWJ are zero-width.
function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f || cp === 0x200d) continue;
    w += cp >= 0x2190 ? 2 : 1;
  }
  return w;
}

const BAR_LENGTH = 25; // matches the wakatime block's bar width, for visual parity

function bar(pct) {
  const filled = Math.min(BAR_LENGTH, Math.max(0, Math.round((pct / 100) * BAR_LENGTH)));
  return ">".repeat(filled) + "-".repeat(BAR_LENGTH - filled);
}

function pad(str, width) {
  return str + " ".repeat(Math.max(0, width - displayWidth(str)));
}

// Mirrors the wakatime block's grammar: name | time | proportional bar | percentage.
// Percentage is each game's share of playtime_forever across the whole library
// (grandTotalMinutes), the Steam equivalent of wakatime's "share of total coding time".
function formatRows(games, grandTotalMinutes) {
  const rows = games.map((g) => ({
    name: emojiFor(g.appid) + g.name,
    time: fmtTime(g.playtime_forever),
    pct: grandTotalMinutes > 0 ? (g.playtime_forever / grandTotalMinutes) * 100 : 0,
  }));

  const nameWidth = Math.max(...rows.map((r) => displayWidth(r.name))) + 2;
  const timeWidth = Math.max(...rows.map((r) => displayWidth(r.time))) + 2;

  return rows
    .map((r) => {
      const pctStr = r.pct.toFixed(2).padStart(5, "0");
      return pad(r.name, nameWidth) + pad(r.time, timeWidth) + bar(r.pct) + "   " + pctStr + " %";
    })
    .join("\n");
}

async function steamApi(method, params) {
  const url = new URL(`https://api.steampowered.com/IPlayerService/${method}/v1/`);
  url.searchParams.set("key", STEAM_API_KEY);
  url.searchParams.set("steamid", STEAM_ID);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${method} failed: ${res.status}`);
  return (await res.json()).response;
}

function replaceBlock(text, startTag, endTag, block) {
  const start = text.indexOf(startTag);
  const end = text.indexOf(endTag);
  if (start === -1 || end === -1) throw new Error(`markers not found: ${startTag}`);
  const before = text.slice(0, start + startTag.length);
  const after = text.slice(end);
  return `${before}\n${block}\n${after}`;
}

async function main() {
  const owned = await steamApi("GetOwnedGames", { include_appinfo: 1 });
  const grandTotalMinutes = owned.games.reduce((sum, g) => sum + g.playtime_forever, 0);
  const playtime = [...owned.games]
    .sort((a, b) => b.playtime_forever - a.playtime_forever)
    .slice(0, 5);

  const recentRes = await steamApi("GetRecentlyPlayedGames", { count: 5 });
  const recent = (recentRes.games || []).slice(0, 5);

  let text = fs.readFileSync(MARKDOWN_FILE, "utf8");

  text = replaceBlock(
    text,
    "<!-- steam-box-playtime start -->",
    "<!-- steam-box-playtime end -->",
    "🎮 Steam playtime leaderboard\n```lua\n" + formatRows(playtime, grandTotalMinutes) + "\n```"
  );

  text = replaceBlock(
    text,
    "<!-- steam-box-recent start -->",
    "<!-- steam-box-recent end -->",
    "🎮 Recently played Steam games\n```lua\n" + formatRows(recent, grandTotalMinutes) + "\n```"
  );

  fs.writeFileSync(MARKDOWN_FILE, text);
  console.log("Updated", MARKDOWN_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
