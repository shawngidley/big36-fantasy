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
games_by_id = {int(game['id']): game for game in games}


def school_from_team_value(game, value):
    value = normal(value)
    for school in [game['homeTeam'], game['awayTeam']]:
        if normal(school) and (normal(school) in value or value in normal(school)):
            return school
    return None


frame = pl.read_parquet('/tmp/cfbfastR_2025_kst_def_candidates.parquet')
matches = []
for row in ledger['rows']:
    school = row['school_name']
    for event in [event for event in row['evidence'] if event['event'] == 'SPECIAL_TEAMS_SAFETY']:
        game_id = int(event['game_id'])
        game = games_by_id[game_id]
        candidates = []
        for candidate in frame.filter(pl.col('game_id').cast(pl.Int64) == game_id).to_dicts():
            text = str(candidate.get('text') or '')
            if not (candidate.get('safety') or candidate.get('punt_safety') or 'safety' in text.lower()):
                continue
            if 'punt' not in text.lower() or 'block' not in text.lower():
                continue
            candidate_school = school_from_team_value(game, candidate.get('def_pos_team'))
            if candidate_school == school:
                candidates.append({'id': str(candidate.get('id') or ''), 'text': text, 'punt_safety': candidate.get('punt_safety'), 'safety': candidate.get('safety')})
        matches.append({'school_name': school, 'event': event, 'matched': bool(candidates), 'cfbfastR_candidates': candidates})
output = {'season': 2025, 'summary': {'events': len(matches), 'matched_events': sum(item['matched'] for item in matches), 'unmatched_events': sum(not item['matched'] for item in matches)}, 'matches': matches}
Path('/tmp/cfbfastr_espn_2025_kst_safety_reconciliation.json').write_text(json.dumps(output, indent=2))
print(json.dumps({'output': '/tmp/cfbfastr_espn_2025_kst_safety_reconciliation.json', 'summary': output['summary']}, indent=2))
