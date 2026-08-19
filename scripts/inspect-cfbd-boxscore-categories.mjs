import { readFile } from 'node:fs/promises';

const boxes = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/boxscores/Texas.json', 'utf8'));
const team = boxes[0]?.teams?.find(entry => entry.team === 'Texas') ?? boxes[0]?.teams?.[0];
console.log(JSON.stringify({
  game_id: boxes[0]?.id,
  team: team?.team,
  categories: team?.categories?.map(category => ({
    name: category.name,
    types: category.types?.map(type => type.name),
  })),
}, null, 2));
