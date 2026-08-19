import json
from pathlib import Path


ledger = json.loads(Path('/tmp/cfbfastR_2025_offensive_td_ledger.json').read_text())
cases = []
for row in ledger['rows']:
    control = {
        'touchdowns': row['control_touchdowns'],
        'passing_touchdowns': row['control_passing_touchdowns'],
        'rushing_touchdowns': row['control_rushing_touchdowns'],
    }
    deltas = {
        metric: int(row.get(metric) or 0) - int(control.get(metric) or 0)
        for metric in ('touchdowns', 'passing_touchdowns', 'rushing_touchdowns')
    }
    if sum(abs(value) for value in deltas.values()) == 2 and deltas['touchdowns'] == -1:
        cases.append({
            'school_name': row['school_name'],
            'position': row['position'],
            'deltas': deltas,
            'events': row['events'],
            'control': control,
        })
Path('/tmp/cfbfastR_2025_one_touchdown_undercounts.json').write_text(json.dumps(cases, indent=2))
Path('/tmp/cfbfastR_2025_one_touchdown_undercount_ids.txt').write_text('\n'.join(f"{case['school_name']}::{case['position']}" for case in cases) + '\n')
print(json.dumps({'cases': len(cases), 'by_position': {p: sum(c['position'] == p for c in cases) for p in ('QB', 'RB', 'WR', 'TE')}}, indent=2))
