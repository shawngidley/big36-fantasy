from pathlib import Path
import json
import polars as pl
from sportsdataverse.cfb.cfb_loaders import load_cfb_game_rosters

cache = Path('/tmp/big36_2025_cfbd_cache')
games = json.loads((cache / 'regular_games.json').read_text())
teams = json.loads(Path('/tmp/cfbd_2025_fbs_teams.json').read_text())

def normalize(value):
    return ' '.join(str(value or '').strip().lower().split())

selected = set()
for team in teams:
    school = team['school']
    eligible = [game for game in games if game['seasonType'] == 'regular' and normalize(school) in {normalize(game['homeTeam']), normalize(game['awayTeam'])}]
    eligible.sort(key=lambda game: (game['startDate'], int(game['id'])))
    selected.update(int(game['id']) for game in eligible[:12])

frame = load_cfb_game_rosters(seasons=[2025])
if not isinstance(frame, pl.DataFrame):
    frame = pl.DataFrame(frame)
game_column = next((column for column in ['game_id', 'gameId', 'id_game'] if column in frame.columns), None)
if not game_column:
    raise RuntimeError(f'Could not find game id column in roster frame: {frame.columns}')
filtered = frame.filter(pl.col(game_column).cast(pl.Int64).is_in(list(selected)))
out = Path('/tmp/cfbfastR_2025_first12_game_rosters.parquet')
filtered.write_parquet(out)
print({'output': str(out), 'rows': filtered.height, 'game_column': game_column, 'columns': filtered.columns})
