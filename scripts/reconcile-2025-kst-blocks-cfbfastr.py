import json
import re
from pathlib import Path

import polars as pl


def normal(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().lower())


teams = json.loads(Path('/tmp/cfbd_2025_fbs_teams.json').read_text())
games = json.loads(Path('/tmp/big36_2025_cfbd_cache/regular_games.json').read_text())
ledger = json.loads(Path('/tmp/espn_core_2025_kst_full_ledger.json').read_text())
schools = [team['school'] for team in teams]
selected_by_school = {}
games_by_id = {int(game['id']): game for game in games}
for school in schools:
    selected = [game for game in games if game['seasonType'] == 'regular' and normal(school) in {normal(game['homeTeam']), normal(game['awayTeam'])}]
    selected.sort(key=lambda game: (game['startDate'], int(game['id'])))
    selected_by_school[normal(school)] = {int(game['id']) for game in selected[:12] if game['completed']}


def school_for_game_value(game, value):
    value = normal(value)
    for school in [game['homeTeam'], game['awayTeam']]:
        if normal(school) and (normal(school) in value or value in normal(school)):
            return school
    return None


frame = pl.read_parquet('/tmp/cfbfastR_2025_kst_def_candidates.parquet')
cfb_events_by_game_school = {}
for row in frame.to_dicts():
    game = games_by_id.get(int(row['game_id']))
    if not game or row.get('penalty_no_play') or row.get('penalty_offset'):
        continue
    text = str(row.get('text') or '')
    if not re.search(r'(?:punt|field goal|fg|pat|kick attempt).{0,110}blocked|blocked.{0,110}(?:punt|field goal|fg|pat|kick)', text, flags=re.I):
        continue
    school = school_for_game_value(game, row.get('def_pos_team'))
    if not school or int(row['game_id']) not in selected_by_school.get(normal(school), set()):
        continue
    cfb_events_by_game_school.setdefault((int(row['game_id']), school), []).append({'text': text, 'id': str(row.get('id') or ''), 'play_number': row.get('game_play_number')})

rows = []
for ledger_row in ledger['rows']:
    school = ledger_row['school_name']
    espn = [event for event in ledger_row['evidence'] if event['event'] == 'BLOCK']
    matches = []
    for event in espn:
        candidates = cfb_events_by_game_school.get((int(event['game_id']), school), [])
        event_numbers = set(re.findall(r'\b\d{2,3}\b', normal(event['text'])))
        event_words = set(normal(event['text']).split())
        scored = []
        for candidate in candidates:
            candidate_numbers = set(re.findall(r'\b\d{2,3}\b', normal(candidate['text'])))
            candidate_words = set(normal(candidate['text']).split())
            score = len(event_numbers & candidate_numbers) * 3 + len(event_words & candidate_words)
            scored.append((score, candidate))
        scored.sort(key=lambda item: item[0], reverse=True)
        match = scored[0][1] if scored and scored[0][0] >= 5 else None
        matches.append({'event': event, 'matched': match is not None, 'cfbfastR_match': match, 'cfbfastR_candidates': candidates})
    rows.append({'school_name': school, 'espn_block_count': len(espn), 'matched_block_count': sum(item['matched'] for item in matches), 'unmatched': [item for item in matches if not item['matched']], 'matches': matches})

output = {
    'season': 2025,
    'summary': {
        'units_with_blocks': sum(bool(row['espn_block_count']) for row in rows),
        'espn_blocks': sum(row['espn_block_count'] for row in rows),
        'matched_blocks': sum(row['matched_block_count'] for row in rows),
        'units_with_unmatched_blocks': sum(bool(row['unmatched']) for row in rows),
    },
    'rows': rows,
}
Path('/tmp/cfbfastr_espn_2025_kst_block_reconciliation.json').write_text(json.dumps(output, indent=2))
print(json.dumps({'output': '/tmp/cfbfastr_espn_2025_kst_block_reconciliation.json', 'summary': output['summary']}, indent=2))
