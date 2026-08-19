import json
import re
from pathlib import Path

import polars as pl

SEASON = 2025
CACHE = Path('/tmp/big36_2025_cfbd_cache')


def normalize(value):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower())).strip()


def roster_cache_key(school):
    return re.sub(r'[^a-z0-9]+', '_', str(school or '').strip().lower())


position_map = {'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE', 'K': 'K_ST', 'PK': 'K_ST', 'P': 'K_ST'}
teams = json.loads(Path('/tmp/cfbd_2025_fbs_teams.json').read_text())
games = json.loads((CACHE / 'regular_games.json').read_text())

eligible_by_school = {}
games_by_id = {int(game['id']): game for game in games}
for team in teams:
    school = team['school']
    selected = [game for game in games if game['seasonType'] == 'regular' and normalize(school) in {normalize(game['homeTeam']), normalize(game['awayTeam'])}]
    selected.sort(key=lambda game: (game['startDate'], int(game['id'])))
    eligible_by_school[normalize(school)] = {int(game['id']) for game in selected[:12]}

roster_positions = {}
for team in teams:
    school = team['school']
    roster = json.loads((CACHE / f'roster_{roster_cache_key(school)}.json').read_text())
    lookup = {}
    for athlete in roster:
        position = position_map.get(str(athlete.get('position', '')).upper())
        if not position:
            continue
        full = normalize(f"{athlete.get('firstName', '')} {athlete.get('lastName', '')}")
        if full:
            lookup[full] = position
    roster_positions[normalize(school)] = lookup

position_identifiers = json.loads(Path('/tmp/espn_cfb_position_identifiers.json').read_text())
position_by_href = {
    href: {'QB': 'QB', 'RB': 'RB', 'FB': 'RB', 'WR': 'WR', 'TE': 'TE', 'PK': 'K_ST', 'P': 'K_ST'}.get(str(value.get('abbreviation', '')).upper(), 'NON_UNIT')
    for href, value in position_identifiers.items()
}
game_rosters = pl.read_parquet('/tmp/cfbfastR_2025_first12_game_rosters.parquet')
game_player_positions = {}
for athlete in game_rosters.select(['game_id', 'full_name', 'position_href']).to_dicts():
    position = position_by_href.get(athlete.get('position_href'))
    name = normalize(athlete.get('full_name'))
    if not position or not name:
        continue
    game_player_positions.setdefault(int(athlete['game_id']), {}).setdefault(name, set()).add(position)


def school_for_pos_team(game, pos_team):
    target = normalize(pos_team)
    candidates = []
    for school in [game['homeTeam'], game['awayTeam']]:
        key = normalize(school)
        if key and (key in target or target in key):
            candidates.append(school)
    return max(candidates, key=lambda school: len(normalize(school)), default=None)


def player_position(game_id, school, name):
    if not school or not name:
        return None
    cleaned = re.sub(r'\s+\d+\s+yd(?:s)?$', '', str(name), flags=re.I)
    suffixless = re.sub(r'\s+\b(?:jr|sr|ii|iii|iv|v)\.?$', '', cleaned, flags=re.I)
    candidates_to_try = list(dict.fromkeys([normalize(cleaned), normalize(suffixless)]))
    game_lookup = game_player_positions.get(int(game_id), {})
    lookup = roster_positions.get(normalize(school), {})
    for full in candidates_to_try:
        game_candidates = game_lookup.get(full, set())
        if len(game_candidates) == 1:
            return next(iter(game_candidates))
        parts = full.split()
        if len(parts) >= 2 and len(parts[0]) == 1:
            initial = parts[0]
            surname = parts[-1]
            abbreviated_candidates = {
                position
                for player, positions in game_lookup.items()
                if player.startswith(f'{initial} ') and player.endswith(f' {surname}')
                for position in positions
            }
            if len(abbreviated_candidates) == 1:
                return next(iter(abbreviated_candidates))
        if full in lookup:
            return lookup[full]
        if len(parts) >= 2:
            surname = parts[-1]
            matched_positions = {position for player, position in lookup.items() if player.endswith(f' {surname}')}
            if len(matched_positions) == 1:
                return matched_positions.pop()
    return None


def primary_pass_players(row):
    passer = str(row.get('passer_player_name') or '').strip()
    receiver = str(row.get('receiver_player_name') or '').strip()
    text = str(row.get('text') or '')
    if not receiver:
        from_match = re.search(r'^(?P<receiver>.+?)\s+\d+\s+yd(?:s)?\s+pass\s+from\s+(?P<passer>[^()]+?)(?:\s*\(|$)', text, flags=re.I)
        complete_match = re.search(r'(?P<passer>.+?)\s+pass\s+complete\s+to\s+(?P<receiver>.+?)\s+for\s+', text, flags=re.I)
        match = from_match or complete_match
        if match:
            passer = passer or match.group('passer').strip()
            receiver = match.group('receiver').strip()
    return passer, receiver


frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
rows = frame.to_dicts()
ledger = {}
unassigned = []
conversion_event_keys = set()


def add_event(school, position, event_kind, row):
    if position not in {'QB', 'RB', 'WR', 'TE'}:
        return
    key = f'{normalize(school)}::{position}'
    entry = ledger.setdefault(key, {
        'school_name': school,
        'position': position,
        'touchdowns': 0,
        'passing_touchdowns': 0,
        'rushing_touchdowns': 0,
        'two_point_conversions': 0,
        'tier_events_missing_distance': 0,
        'tier_points': 0,
        'events': [],
    })
    distance = row.get('start.yardsToEndzone')
    distance = int(distance) if distance is not None and int(distance) > 0 else None
    entry['touchdowns'] += 1
    if event_kind == 'pass' and position == 'QB':
        entry['passing_touchdowns'] += 1
    if event_kind == 'rush':
        entry['rushing_touchdowns'] += 1
    if distance is None:
        entry['tier_events_missing_distance'] += 1
    else:
        entry['tier_points'] += 6 if distance <= 9 else 8 if distance <= 29 else 10 if distance <= 59 else 12
    event = {
        'game_id': int(row['game_id']),
        'id': int(row['id']) if row.get('id') is not None else None,
        'text': row.get('text'),
        'distance': distance,
        'pass_td': bool(row.get('pass_td')),
        'rush_td': bool(row.get('rush_td')),
    }
    if row.get('_audit_passer_name'):
        event['passer_name'] = row.get('_audit_passer_name')
        event['passer_position'] = row.get('_audit_passer_position')
        event['receiver_name'] = row.get('_audit_receiver_name')
        event['receiver_position'] = row.get('_audit_receiver_position')
    entry['events'].append(event)


def add_conversion(school, position, conversion_kind, row, text):
    if position not in {'QB', 'RB', 'WR', 'TE'}:
        return
    key = f'{normalize(school)}::{position}'
    entry = ledger.setdefault(key, {
        'school_name': school,
        'position': position,
        'touchdowns': 0,
        'passing_touchdowns': 0,
        'rushing_touchdowns': 0,
        'two_point_conversions': 0,
        'tier_events_missing_distance': 0,
        'tier_points': 0,
        'events': [],
    })
    entry['two_point_conversions'] += 1
    entry['tier_points'] += 4
    entry['events'].append({
        'game_id': int(row['game_id']),
        'id': int(row['id']) if row.get('id') is not None else None,
        'text': text,
        'distance': None,
        'two_point_conversion': conversion_kind,
    })


def conversion_clause(text):
    match = re.search(r'\(([^)]*two[\s-]*point[^)]*)\)', str(text or ''), flags=re.I)
    return match.group(1) if match else ''


def conversion_players(clause):
    passing = re.search(r'(?P<passer>[A-Za-z0-9 .\'-]+?)\s+pass(?:\s+(?:complete\s+)?to\s+(?P<receiver>[A-Za-z0-9 .\'-]+?))?\s+for\s+two[\s-]*point', clause, flags=re.I)
    if passing:
        return ('pass', passing.group('passer').strip(), (passing.group('receiver') or '').strip())
    rushing = re.search(r'(?P<rusher>[A-Za-z0-9 .\'-]+?)\s+(?:run|rush)\s+for\s+two[\s-]*point', clause, flags=re.I)
    if rushing:
        return ('rush', rushing.group('rusher').strip(), '')
    return (None, '', '')


for row in rows:
    game_id = int(row['game_id'])
    game = games_by_id.get(game_id)
    if not game:
        continue
    school = school_for_pos_team(game, row.get('pos_team'))
    if not school or game_id not in eligible_by_school.get(normalize(school), set()):
        continue
    if row.get('penalty_no_play') or row.get('penalty_offset') or 'call overturned' in str(row.get('text') or '').lower():
        continue
    if row.get('defense_score_play') or not row.get('offense_score_play'):
        continue
    if row.get('pass_td'):
        passer_name, receiver_name = primary_pass_players(row)
        passer = player_position(game_id, school, passer_name)
        receiver = player_position(game_id, school, receiver_name)
        audit_row = dict(row)
        audit_row.update({
            '_audit_passer_name': passer_name,
            '_audit_passer_position': passer,
            '_audit_receiver_name': receiver_name,
            '_audit_receiver_position': receiver,
        })
        if passer == 'QB':
            add_event(school, 'QB', 'pass', audit_row)
        if receiver in {'QB', 'RB', 'WR', 'TE'}:
            add_event(school, receiver, 'receive', audit_row)
            if passer is None:
                unassigned.append({'school_name': school, 'game_id': game_id, 'text': row.get('text'), 'passer': passer_name, 'passer_position': passer, 'receiver': receiver_name, 'receiver_position': receiver, 'kind': 'passer_unknown_receiver_credited'})
        elif passer is None:
            unassigned.append({'school_name': school, 'game_id': game_id, 'text': row.get('text'), 'passer': passer_name, 'passer_position': passer, 'receiver': receiver_name, 'receiver_position': receiver, 'kind': 'receiver_unknown'})
    elif row.get('rush_td'):
        rusher = player_position(game_id, school, row.get('rusher_player_name'))
        if rusher not in {'QB', 'RB', 'WR', 'TE'}:
            if rusher is None:
                unassigned.append({'school_name': school, 'game_id': game_id, 'text': row.get('text'), 'rusher': row.get('rusher_player_name'), 'rusher_position': rusher, 'kind': 'rush'})
        else:
            add_event(school, rusher, 'rush', row)
    if row.get('two_point_conv_result') == 'success':
        clause = conversion_clause(row.get('text'))
        kind, primary, secondary = conversion_players(clause)
        conversion_key = (game_id, normalize(clause))
        if kind and conversion_key not in conversion_event_keys:
            conversion_event_keys.add(conversion_key)
            primary_position = player_position(game_id, school, primary)
            if kind == 'pass':
                secondary_position = player_position(game_id, school, secondary)
                if primary_position == 'QB':
                    add_conversion(school, 'QB', 'pass', row, clause)
                if secondary_position in {'QB', 'RB', 'WR', 'TE'}:
                    add_conversion(school, secondary_position, 'receive', row, clause)
                elif secondary_position is None:
                    unassigned.append({'school_name': school, 'game_id': game_id, 'text': row.get('text'), 'conversion_clause': clause, 'kind': 'two_point_pass', 'passer_position': primary_position, 'receiver_position': secondary_position})
            elif primary_position in {'QB', 'RB', 'WR', 'TE'}:
                add_conversion(school, primary_position, 'rush', row, clause)
            else:
                unassigned.append({'school_name': school, 'game_id': game_id, 'text': row.get('text'), 'conversion_clause': clause, 'kind': 'two_point_rush', 'rusher_position': primary_position})

qb_controls = json.loads(Path('/tmp/qb_2025_espn_boxscore_certification.json').read_text())['rows']
non_qb_controls = json.loads(Path('/tmp/non_qb_2025_boxscore_certification.json').read_text())['rows']
controls = {}
for row in qb_controls:
    official = row['official_boxscore']
    controls[f"{normalize(row['school_name'])}::QB"] = {
        'touchdowns': official['passing_touchdowns'] + official['rushing_touchdowns'],
        'passing_touchdowns': official['passing_touchdowns'],
        'rushing_touchdowns': official['rushing_touchdowns'],
    }
for row in non_qb_controls:
    if row['position'] in {'RB', 'WR', 'TE'}:
        controls[f"{normalize(row['school_name'])}::{row['position']}"] = row['control']

output_rows = []
for school in [team['school'] for team in teams]:
    for position in ['QB', 'RB', 'WR', 'TE']:
        row = ledger.get(f'{normalize(school)}::{position}', {'school_name': school, 'position': position, 'touchdowns': 0, 'passing_touchdowns': 0, 'rushing_touchdowns': 0, 'two_point_conversions': 0, 'tier_events_missing_distance': 0, 'tier_points': 0, 'events': []})
        control = controls.get(f'{normalize(school)}::{position}', {})
        output_rows.append({
            **row,
            'control_touchdowns': control.get('touchdowns'),
            'control_passing_touchdowns': control.get('passing_touchdowns'),
            'control_rushing_touchdowns': control.get('rushing_touchdowns'),
            'matches_control': row['touchdowns'] == control.get('touchdowns') and (position != 'QB' or row['passing_touchdowns'] == control.get('passing_touchdowns')),
        })

summary = {}
for position in ['QB', 'RB', 'WR', 'TE']:
    group = [row for row in output_rows if row['position'] == position]
    summary[position] = {
        'units': len(group),
        'control_matches': sum(row['matches_control'] for row in group),
        'unmatched': sum(not row['matches_control'] for row in group),
        'missing_tier_events': sum(row['tier_events_missing_distance'] for row in group),
    }

output = {'season': SEASON, 'summary': summary, 'rows': output_rows, 'unassigned_events': unassigned}
Path('/tmp/cfbfastR_2025_offensive_td_ledger.json').write_text(json.dumps(output, indent=2))
print(json.dumps({'output': '/tmp/cfbfastR_2025_offensive_td_ledger.json', 'summary': summary, 'unassigned_events': len(unassigned)}, indent=2))
