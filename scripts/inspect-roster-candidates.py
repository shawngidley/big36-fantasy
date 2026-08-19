import json
import re

import pandas as pd

exceptions = json.load(open('/tmp/cfbfastR_2025_offensive_td_ledger.json'))['unassigned_events']
rosters = pd.read_parquet('/tmp/cfbfastR_2025_first12_game_rosters.parquet')
identifiers = json.load(open('/tmp/espn_cfb_position_identifiers.json'))
position_by_href = {href: value.get('abbreviation') for href, value in identifiers.items()}

for event in exceptions:
    name = event.get('rusher') or event.get('receiver')
    if not name and event.get('conversion_clause'):
        clause = event['conversion_clause']
        match = re.search(r'([A-Za-z.\' -]+?)\s+(?:pass|run|rush)', clause, flags=re.I)
        name = match.group(1).strip() if match else ''
    if not name:
        continue
    cleaned = re.sub(r'\s+\d+\s+yd(?:s)?$', '', str(name), flags=re.I).strip()
    surname = re.sub(r'\b(?:jr|sr|ii|iii|iv|v)\.?$', '', cleaned, flags=re.I).strip().split()[-1]
    game = rosters[rosters['game_id'].eq(event['game_id'])]
    hits = game[game['full_name'].fillna('').str.lower().str.contains(surname.lower(), regex=False)]
    print(json.dumps({
        'game_id': event['game_id'],
        'school_name': event['school_name'],
        'kind': event['kind'],
        'source_name': name,
        'matches': [
            {'full_name': row.full_name, 'position': position_by_href.get(row.position_href)}
            for row in hits[['full_name', 'position_href']].drop_duplicates().itertuples(index=False)
        ],
    }))
