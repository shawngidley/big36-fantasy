import json
import sys
from pathlib import Path
import re
import polars as pl

school = sys.argv[1] if len(sys.argv) > 1 else 'UNLV'
norm = lambda value: re.sub(r'\s+', ' ', str(value or '').strip().lower())
cache = Path('/tmp/big36_2025_cfbd_cache')
games = json.loads((cache / 'regular_games.json').read_text())
selected = [game for game in games if game['seasonType'] == 'regular' and norm(school) in {norm(game['homeTeam']), norm(game['awayTeam'])}]
selected.sort(key=lambda game: (game['startDate'], int(game['id'])))
selected = selected[:12]
ids = [int(game['id']) for game in selected]
frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
rows = frame.filter(pl.col('game_id').cast(pl.Int64).is_in(ids)).select([
    column for column in ['game_id', 'pos_team', 'def_pos_team', 'text', 'pass_td', 'rush_td', 'scoring_play', 'offense_score_play', 'defense_score_play', 'passer_player_name', 'rusher_player_name', 'receiver_player_name'] if column in frame.columns
]).to_dicts()
print(json.dumps({
    'school': school,
    'selected_games': [{'id': game['id'], 'week': game['week'], 'home': game['homeTeam'], 'away': game['awayTeam'], 'date': game['startDate']} for game in selected],
    'normalized_scoring_rows': rows,
}, indent=2))
