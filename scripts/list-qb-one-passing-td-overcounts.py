import json
from pathlib import Path


summary = json.loads(Path('/tmp/cfbfastR_2025_offensive_mismatch_summary.json').read_text())
cases = [
    entry for entry in summary['rows']['QB']
    if entry['deltas'] == {'touchdowns': 1, 'passing_touchdowns': 1, 'rushing_touchdowns': 0}
]
Path('/tmp/cfbfastR_2025_qb_one_passing_td_overcounts.json').write_text(json.dumps(cases, indent=2))
print(json.dumps({'cases': len(cases), 'schools': [case['school_name'] for case in cases]}, indent=2))
