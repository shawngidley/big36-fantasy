import json
from pathlib import Path

report = json.loads(Path('/tmp/cfbfastR_2025_kst_def_ledger.json').read_text())
for position in ['K_ST', 'DEF']:
    rows = [row for row in report['rows'] if row['position'] == position]
    mismatches = [row for row in rows if not row['matches_direct_controls']]
    unresolved = [row for row in rows if row['unresolved']]
    print(json.dumps({
        'position': position,
        'matches': len(rows) - len(mismatches),
        'mismatches': len(mismatches),
        'unresolved': len(unresolved),
        'sample_mismatches': mismatches[:12],
        'sample_unresolved': unresolved[:6],
    }, indent=2))
