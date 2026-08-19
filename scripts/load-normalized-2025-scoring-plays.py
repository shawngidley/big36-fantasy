from pathlib import Path

import polars as pl
from sportsdataverse.cfb.cfb_loaders import load_cfb_pbp

season = 2025
out_path = Path('/tmp/cfbfastR_2025_scoring_plays.parquet')

frame = load_cfb_pbp(seasons=[season])
if not isinstance(frame, pl.DataFrame):
    frame = pl.DataFrame(frame)

columns = [
    'season', 'game_id', 'game_play_number', 'id', 'text', 'play_type', 'play_text',
    'home_team', 'away_team', 'pos_team', 'def_pos_team', 'start.yardsToEndzone', 'start.yard',
    'yards_gained', 'scoring_play', 'offense_score_play', 'defense_score_play', 'rush_td',
    'pass_td', 'return_td', 'defensive_td', 'passer_player_name', 'rusher_player_name',
    'receiver_player_name', 'interception_player_name', 'fumble_player_name',
    'fumble_recovered_player_name', 'sack_player_name', 'fg_kicker_player_name', 'yds_fg',
    'fg_made', 'two_point_conv_result', 'extra_point_result', 'punt_blocked', 'punt_return', 'kickoff_return', 'kickoff_return_player_name',
    'punt_return_player_name', 'fg_return_player_name', 'punt_block_return_player_name', 'penalty_no_play',
    'penalty_offset', 'penalty_declined', 'safety', 'punt_safety', 'penalty_safety',
]
available = [column for column in columns if column in frame.columns]
scoring = frame.select(available).filter(
    pl.col('scoring_play').fill_null(False)
    | pl.col('offense_score_play').fill_null(False)
    | pl.col('defense_score_play').fill_null(False)
    | pl.col('pass_td').fill_null(False)
    | pl.col('rush_td').fill_null(False)
    | pl.col('fg_made').fill_null(False)
    | pl.col('safety').fill_null(False)
)
scoring.write_parquet(out_path)
summary = {
    'season': season,
    'input_rows': frame.height,
    'scoring_rows': scoring.height,
    'columns': scoring.columns,
    'available_columns': frame.columns,
    'output': str(out_path),
}
print(summary)
