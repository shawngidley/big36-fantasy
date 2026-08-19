import json
from collections import Counter
from pathlib import Path

report = json.loads(Path('/tmp/cfbfastR_2025_offensive_td_ledger.json').read_text())
events = report['unassigned_events']
summary = {
    'total': len(events),
    'by_kind': Counter(event.get('kind', 'unknown') for event in events).most_common(),
    'examples': events[:40],
}
Path('/tmp/cfbfastR_2025_unassigned_offensive_summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
