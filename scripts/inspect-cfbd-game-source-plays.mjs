import { readFile } from "node:fs/promises";

const gameId = Number(process.argv[2] ?? 401756954);
const games = JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/regular_games.json", "utf8"));
const week = Number(process.argv[3] ?? games.find(game => Number(game.id) === gameId)?.week);
if (!week) throw new Error(`Unable to determine the week for game ${gameId}.`);
const plays = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/plays_week_${week}.json`, "utf8"));
const rows = plays.filter(play => Number(play.gameId) === gameId && (play.scoring || /(touchdown|\btd\b|interception)/i.test(`${play.playType ?? ""} ${play.playText ?? ""}`))).map(play => ({ id: play.id, drive_id: play.driveId, play_number: play.playNumber, period: play.period, clock: play.clock, scoring: play.scoring, play_type: play.playType, offense: play.offense, defense: play.defense, text: play.playText }));
console.log(JSON.stringify(rows, null, 2));
