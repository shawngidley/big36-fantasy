import json
import re
from pathlib import Path

import polars as pl


def normal(value):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower())).strip()


def school_for_value(value, candidates):
    value = normal(value)
    matched = [school for school in candidates if value.startswith(normal(school)) or normal(school).startswith(value)]
    return max(matched, key=lambda school: len(normal(school)), default=None)


def defensive_touchdown_points(distance):
    return 9 if distance <= 19 else 12 if distance <= 59 else 15


teams = json.loads(Path('/tmp/cfbd_2025_fbs_teams.json').read_text())
games = json.loads(Path('/tmp/big36_2025_cfbd_cache/regular_games.json').read_text())
controls = json.loads(Path('/tmp/non_qb_2025_boxscore_certification.json').read_text())['rows']
schools = [team['school'] for team in teams]
selected_by_school = {}
game_sides = {}
for school in schools:
    selected = [game for game in games if game['seasonType'] == 'regular' and normal(school) in {normal(game['homeTeam']), normal(game['awayTeam'])}]
    selected.sort(key=lambda game: (game['startDate'], int(game['id'])))
    selected = [game for game in selected[:12] if game['completed']]
    selected_by_school[school] = {int(game['id']) for game in selected}
    for game in selected:
        game_sides[int(game['id'])] = [game['homeTeam'], game['awayTeam']]
control_by_school = {row['school_name']: row['control'] for row in controls if row['position'] == 'DEF'}
ledger = {school: {'school_name': school, 'points': 0, 'events': {'SACK': 0, 'INTERCEPTION': 0, 'FUMBLE_RECOVERY': 0, 'DEFENSIVE_TOUCHDOWN': 0, 'DEFENSIVE_SAFETY': 0, 'SHUTOUT': 0}, 'event_points': {'SACK': 0, 'INTERCEPTION': 0, 'FUMBLE_RECOVERY': 0, 'DEFENSIVE_TOUCHDOWN': 0, 'DEFENSIVE_SAFETY': 0, 'SHUTOUT': 0}, 'unresolved': [], 'evidence': []} for school in schools}


def add(school, event, points, row):
    item = ledger[school]
    item['points'] += points
    item['events'][event] += 1
    item['event_points'][event] += points
    item['evidence'].append({'game_id': int(row['game_id']), 'event': event, 'text': row.get('text')})


for school in schools:
    for game_id in selected_by_school[school]:
        game = next(game for game in games if int(game['id']) == game_id)
        opponent_points = int(game['awayPoints']) if normal(game['homeTeam']) == normal(school) else int(game['homePoints'])
        if opponent_points == 0:
            add(school, 'SHUTOUT', 15, {'game_id': game_id, 'text': 'Official completed-game opponent score: 0'})

frame = pl.read_parquet('/tmp/cfbfastR_2025_kst_def_candidates.parquet')
for row in frame.to_dicts():
    game_id = int(row['game_id'])
    sides = game_sides.get(game_id)
    if not sides or row.get('penalty_no_play') or row.get('penalty_offset'):
        continue
    defense = school_for_value(row.get('def_pos_team'), sides)
    if not defense or defense not in selected_by_school or game_id not in selected_by_school[defense]:
        continue
    if row.get('sack'):
        add(defense, 'SACK', 1, row)
    if row.get('interception_player_name') or re.search(r'\bpass intercepted\b|\bintercepted by\b', str(row.get('text') or ''), flags=re.I):
        add(defense, 'INTERCEPTION', 3, row)
    if row.get('fumble_lost') and row.get('fumble_recovered'):
        add(defense, 'FUMBLE_RECOVERY', 3, row)
    if row.get('defense_score_play'):
        distance = row.get('start.yardsToEndzone')
        if distance is None:
            ledger[defense]['unresolved'].append({'game_id': game_id, 'reason': 'normalized defensive touchdown lacks pre-snap distance', 'text': row.get('text')})
        else:
            add(defense, 'DEFENSIVE_TOUCHDOWN', defensive_touchdown_points(int(distance)), row)
    if row.get('safety') and not row.get('punt_safety'):
        add(defense, 'DEFENSIVE_SAFETY', 6, row)

rows = []
for school in schools:
    item = ledger[school]
    control = control_by_school.get(school, {})
    comparisons = {
        'sacks': {'control': int(control.get('sacks', 0)), 'ledger': item['events']['SACK']},
        'interceptions': {'control': int(control.get('interceptions', 0)), 'ledger': item['events']['INTERCEPTION']},
        'defensive_touchdowns': {'control': int(control.get('defensive_touchdowns', 0)), 'ledger': item['events']['DEFENSIVE_TOUCHDOWN']},
        'shutouts': {'control': int(control.get('shutouts', 0)), 'ledger': item['events']['SHUTOUT']},
    }
    item['comparisons'] = comparisons
    item['matches_visible_controls'] = all(value['control'] == value['ledger'] for value in comparisons.values())
    rows.append(item)
output = {'season': 2025, 'summary': {'units': len(rows), 'visible_control_matches': sum(row['matches_visible_controls'] for row in rows), 'unresolved_units': sum(bool(row['unresolved']) for row in rows)}, 'rows': rows}
Path('/tmp/cfbfastr_2025_def_ledger.json').write_text(json.dumps(output, indent=2))
print(json.dumps({'output': '/tmp/cfbfastr_2025_def_ledger.json', 'summary': output['summary']}, indent=2))
