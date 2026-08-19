import json
from pathlib import Path
from urllib.request import Request, urlopen

import polars as pl

frame = pl.read_parquet('/tmp/cfbfastR_2025_first12_game_rosters.parquet')
hrefs = sorted(set(value for value in frame.get_column('position_href').drop_nulls().to_list() if value))
mapping = {}
for href in hrefs:
    url = str(href).replace('http://', 'https://')
    request = Request(url, headers={'Accept': 'application/json'})
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8'))
        mapping[href] = {
            'id': payload.get('id'),
            'name': payload.get('name'),
            'display_name': payload.get('displayName'),
            'abbreviation': payload.get('abbreviation'),
        }
    except Exception as error:
        mapping[href] = {'error': str(error)}

out = Path('/tmp/espn_cfb_position_identifiers.json')
out.write_text(json.dumps(mapping, indent=2))
print({'output': str(out), 'identifiers': len(mapping)})
