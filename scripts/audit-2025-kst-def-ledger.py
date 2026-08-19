import json
import re
from collections import defaultdict
from pathlib import Path

import polars as pl


def normal(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().lower())


def field_goal_points(distance):
    return 3 if distance <= 29 else 6 if distance <= 39 else 9 if distance <= 49 else 12


def defensive_td_points(distance):
    return 9 if distance <= 19 else 12 if distance <= 59 else 15


def return_distance(text):
    patterns = [r'return(?:ed)?\s+(?:for\s+)?(\d+)\s+yd', r'(\d+)\s+yd\s+return']
    for pattern in patterns:
        match = re.search(pattern, str(text or ''), flags=re.I)
        if match:
            return int(match.group(1))
    return None


def made_field_goal_distance(row):
    if row.get('fg_made') and row.get('yds_fg') is not None:
        return int(row['yds_fg'])
    text = str(row.get('text') or '')
    match = re.search(r'field goal attempt from\s+(\d+)\s+yards?\s+good|\b(\d+)\s+yd\s+fg\s+good', text, flags=re.I)
    if match:
        return int(match.group(1) or match.group(2))
    return None


teams = json.loads(Path('/tmp/cfbd_2025_fbs_teams.json').read_text())
games = json.loads(Path('/tmp/big36_2025_cfbd_cache/regular_games.json').read_text())
controls = json.loads(Path('/tmp/non_qb_2025_boxscore_certification.json').read_text())['rows']
schools = [team['school'] for team in teams]
games_by_id = {int(game['id']): game for game in games}
eligible_by_school = {}
for school in schools:
    selected = [game for game in games if game['seasonType'] == 'regular' and normal(school) in {normal(game['homeTeam']), normal(game['awayTeam'])}]
    selected.sort(key=lambda game: (game['startDate'], int(game['id'])))
    eligible_by_school[normal(school)] = {int(game['id']) for game in selected[:12]}


def school_for_game_side(game, value):
    value = normal(value)
    for school in [game['homeTeam'], game['awayTeam']]:
        school_key = normal(school)
        if school_key and (school_key in value or value in school_key):
            return school
    return None


def event_entry(school, position):
    key = f'{normal(school)}::{position}'
    return ledger.setdefault(key, {
        'school_name': school,
        'position': position,
        'points': 0,
        'events': defaultdict(int),
        'event_points': defaultdict(int),
        'unresolved': [],
    })


def add(school, position, event, points, row):
    if not school:
        return
    item = event_entry(school, position)
    item['points'] += points
    item['events'][event] += 1
    item['event_points'][event] += points


def hold(school, position, reason, row):
    if not school:
        return
    item = event_entry(school, position)
    item['unresolved'].append({
        'reason': reason,
        'game_id': int(row['game_id']),
        'text': row.get('text'),
    })


ledger = {}
seen_field_goals = set()
frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
for row in frame.to_dicts():
    game = games_by_id.get(int(row['game_id']))
    if not game:
        continue
    offense = school_for_game_side(game, row.get('pos_team'))
    defense = school_for_game_side(game, row.get('def_pos_team'))
    if not offense or int(row['game_id']) not in eligible_by_school.get(normal(offense), set()):
        continue
    if row.get('penalty_no_play') or row.get('penalty_offset'):
        continue
    text = str(row.get('text') or '')
    lower = text.lower()
    distance = made_field_goal_distance(row)
    field_goal_key = (int(row['game_id']), normal(text))
    if distance is not None and field_goal_key not in seen_field_goals:
        seen_field_goals.add(field_goal_key)
        if distance < 10:
            hold(offense, 'K_ST', 'field goal lacks a valid official distance', row)
        else:
            add(offense, 'K_ST', 'FIELD_GOAL', field_goal_points(distance), row)
    if str(row.get('extra_point_result') or '').lower() == 'good':
        add(offense, 'K_ST', 'EXTRA_POINT', 1, row)
    if row.get('punt_blocked'):
        if offense:
            add(offense, 'K_ST', 'BLOCKED_PUNT', 3, row)
        else:
            hold(defense, 'K_ST', 'blocked-punt scoring side could not be normalized', row)
    if row.get('punt_safety'):
        add(defense, 'K_ST', 'SPECIAL_TEAMS_SAFETY', 6, row)
    elif row.get('safety'):
        add(defense, 'DEF', 'DEFENSIVE_SAFETY', 6, row)
    special_return = bool(re.search(r'(kickoff|punt|field goal|blocked punt|blocked kick).{0,75}return|return.{0,75}(kickoff|punt|field goal|blocked punt|blocked kick)', lower))
    if special_return and (row.get('offense_score_play') or row.get('defense_score_play')) and ('touchdown' in lower or ' for a td' in lower):
        add(offense, 'K_ST', 'RETURN_TOUCHDOWN', 12, row)
    if row.get('defense_score_play') and not row.get('safety') and not special_return:
        distance = return_distance(text)
        if distance is None:
            hold(defense, 'DEF', 'defensive touchdown has no normalized return distance', row)
        else:
            add(defense, 'DEF', 'DEFENSIVE_TOUCHDOWN', defensive_td_points(distance), row)

control_by_key = {f"{normal(row['school_name'])}::{row['position']}": row['control'] for row in controls if row['position'] in {'K_ST', 'DEF'}}
rows = []
for school in schools:
    for position in ['K_ST', 'DEF']:
        item = event_entry(school, position)
        control = control_by_key.get(f'{normal(school)}::{position}', {})
        events = dict(item['events'])
        if position == 'K_ST':
            comparisons = {
                'field_goals_made': {'control': int(control.get('field_goals_made', 0)), 'ledger': int(events.get('FIELD_GOAL', 0))},
                'extra_points': {'control': int(control.get('extra_points', 0)), 'ledger': int(events.get('EXTRA_POINT', 0))},
                'return_touchdowns': {'control': int(control.get('kick_return_touchdowns', 0)) + int(control.get('punt_return_touchdowns', 0)), 'ledger': int(events.get('RETURN_TOUCHDOWN', 0))},
            }
        else:
            comparisons = {
                'defensive_touchdowns': {'control': int(control.get('defensive_touchdowns', 0)), 'ledger': int(events.get('DEFENSIVE_TOUCHDOWN', 0))},
                'shutouts': {'control': int(control.get('shutouts', 0)), 'ledger': None},
            }
        matches_control = all(value['ledger'] == value['control'] for value in comparisons.values() if value['ledger'] is not None)
        rows.append({
            'school_name': school,
            'position': position,
            'points_from_direct_events': item['points'],
            'events': events,
            'event_points': dict(item['event_points']),
            'comparisons': comparisons,
            'matches_direct_controls': matches_control,
            'unresolved': item['unresolved'],
        })

summary = {}
for position in ['K_ST', 'DEF']:
    group = [row for row in rows if row['position'] == position]
    summary[position] = {
        'units': len(group),
        'direct_control_matches': sum(row['matches_direct_controls'] for row in group),
        'units_with_unresolved_direct_events': sum(bool(row['unresolved']) for row in group),
    }
output = {'season': 2025, 'summary': summary, 'rows': rows}
Path('/tmp/cfbfastR_2025_kst_def_ledger.json').write_text(json.dumps(output, indent=2))
print(json.dumps({'output': '/tmp/cfbfastR_2025_kst_def_ledger.json', 'summary': summary}, indent=2))
