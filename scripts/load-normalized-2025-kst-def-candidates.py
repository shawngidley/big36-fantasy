from pathlib import Path

import polars as pl
from sportsdataverse.cfb.cfb_loaders import load_cfb_pbp


season = 2025
out_path = Path('/tmp/cfbfastR_2025_kst_def_candidates.parquet')
frame = load_cfb_pbp(seasons=[season])
if not isinstance(frame, pl.DataFrame):
    frame = pl.DataFrame(frame)

columns = [
    'season', 'game_id', 'game_play_number', 'id', 'text', 'play_type', 'play_text', 'home_team', 'away_team', 'pos_team', 'def_pos_team',
    'start.yardsToEndzone', 'yards_gained', 'scoring_play', 'offense_score_play', 'defense_score_play', 'return_td', 'defensive_td',
    'interception', 'interception_player_name', 'sack', 'sack_player_name', 'fumble', 'fumble_lost', 'fumble_recovered', 'fumble_recovered_player_name',
    'fg_made', 'fg_blocked', 'punt_blocked', 'punt_safety', 'safety', 'penalty_no_play', 'penalty_offset', 'penalty_declined',
    'kickoff_return', 'punt_return', 'fg_return_player_name', 'punt_block_return_player_name',
]
available = [column for column in columns if column in frame.columns]
text_column = 'text' if 'text' in frame.columns else 'play_text'
condition = pl.col(text_column).cast(pl.Utf8).str.contains(r'(?i)\b(blocked|sacked|intercepted|fumble|safety)\b').fill_null(False)
for column in ['sack', 'interception', 'fumble', 'fumble_lost', 'fumble_recovered', 'fg_blocked', 'punt_blocked', 'punt_safety', 'safety', 'return_td', 'defensive_td']:
    if column in frame.columns:
        condition = condition | pl.col(column).cast(pl.Boolean, strict=False).fill_null(False)
candidates = frame.select(available).filter(condition)
candidates.write_parquet(out_path)
print({'season': season, 'input_rows': frame.height, 'candidate_rows': candidates.height, 'columns': candidates.columns, 'output': str(out_path)})
