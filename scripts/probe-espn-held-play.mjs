const eventId = process.argv[2] ?? '401756888';
const sourceEventId = process.argv[3] ?? '401756888104999904';
const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/${eventId}/competitions/${eventId}/plays?limit=1000`;

const response = await fetch(url, { headers: { Accept: 'application/json' } });
if (!response.ok) throw new Error(`ESPN core plays request failed: ${response.status} ${response.statusText}`);
const payload = await response.json();
const items = payload.items ?? payload.plays ?? [];
const match = items.find((play) => String(play.id) === sourceEventId || String(play.ref ?? '').endsWith(`/${sourceEventId}`));

console.log(JSON.stringify({
  url,
  item_count: items.length,
  requested_source_event_id: sourceEventId,
  matching_play: match ?? null,
  first_item_keys: items[0] ? Object.keys(items[0]) : [],
}, null, 2));
