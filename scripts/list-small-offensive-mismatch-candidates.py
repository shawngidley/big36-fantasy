import json
from pathlib import Path


summary = json.loads(Path('/tmp/cfbfastR_2025_offensive_mismatch_summary.json').read_text())
rows = []
for position, entries in summary['rows'].items():
    for entry in entries:
        magnitude = sum(abs(value) for value in entry['deltas'].values())
        if magnitude <= 2 and entry['tier_events_missing_distance'] == 0:
            rows.append({
                'school_name': entry['school_name'],
                'position': position,
                'deltas': entry['deltas'],
                'two_point_conversions': entry['two_point_conversions'],
                'event_count': len(entry['events']),
                'events': entry['events'],
            })
Path('/tmp/cfbfastR_2025_small_offensive_mismatch_candidates.json').write_text(json.dumps(rows, indent=2))
print(json.dumps({'candidates': len(rows), 'by_position': {position: sum(row['position'] == position for row in rows) for position in summary['rows']}}, indent=2))
