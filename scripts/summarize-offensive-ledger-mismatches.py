import json
from collections import Counter, defaultdict
from pathlib import Path


ledger = json.loads(Path('/tmp/cfbfastR_2025_offensive_td_ledger.json').read_text())
grouped = defaultdict(list)
for row in ledger['rows']:
    if row.get('matches_control'):
        continue
    position = row['position']
    deltas = {}
    for key in ('touchdowns', 'passing_touchdowns', 'rushing_touchdowns'):
        control = row.get(f'control_{key}')
        if control is not None:
            deltas[key] = int(row.get(key, 0)) - int(control)
    direction = ', '.join(f'{key}:{delta:+d}' for key, delta in deltas.items() if delta) or 'non-count control mismatch'
    grouped[position].append({'school_name': row['school_name'], 'deltas': deltas, 'direction': direction, 'tier_events_missing_distance': row.get('tier_events_missing_distance', 0), 'two_point_conversions': row.get('two_point_conversions', 0), 'events': row.get('events', [])})
output = {
    'summary': {
        position: {
            'mismatched_units': len(rows),
            'delta_patterns': Counter(item['direction'] for item in rows),
            'units_with_missing_tier_distance': sum(item['tier_events_missing_distance'] > 0 for item in rows),
            'units_with_conversions': sum(item['two_point_conversions'] > 0 for item in rows),
        }
        for position, rows in grouped.items()
    },
    'rows': {position: rows for position, rows in grouped.items()},
}
Path('/tmp/cfbfastR_2025_offensive_mismatch_summary.json').write_text(json.dumps(output, indent=2))
print(json.dumps(output['summary'], indent=2))
