import json
from pathlib import Path

import polars as pl


game_ids = [401760379, 401756955, 401756893, 401760423, 401761631]
frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
columns = [
    name for name in [
        'game_id', 'id', 'text', 'pos_team', 'pass_td', 'rush_td',
        'offense_score_play', 'defense_score_play', 'scoring',
        'penalty_no_play', 'penalty_offset', 'passer_player_name',
        'receiver_player_name', 'rusher_player_name', 'start.yardsToEndzone',
    ] if name in frame.columns
]
rows = frame.filter(pl.col('game_id').is_in(game_ids)).select(columns).to_dicts()
Path('/tmp/cfbfastR_normalized_scoring_flag_inspection.json').write_text(json.dumps(rows, indent=2, default=str))
print(json.dumps({'games': game_ids, 'rows': len(rows), 'columns': columns}, indent=2))
