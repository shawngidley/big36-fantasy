import json
import polars as pl

frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
fields = [
    'fg_made', 'extra_point_result', 'punt_blocked', 'punt_return', 'kickoff_return',
    'return_td', 'defensive_td', 'safety', 'punt_safety', 'penalty_safety',
    'offense_score_play', 'defense_score_play', 'yds_fg', 'yards_gained', 'start.yardsToEndzone',
]
summary = {}
for field in fields:
    if field not in frame.columns:
        continue
    values = frame.get_column(field)
    sample_frame = frame.filter(pl.col(field).fill_null(False)) if values.dtype == pl.Boolean else frame.filter(pl.col(field).is_not_null())
    summary[field] = {
        'non_null': int(values.is_not_null().sum()),
        'true': int(values.cast(pl.Boolean, strict=False).fill_null(False).sum()) if values.dtype == pl.Boolean else None,
        'samples': sample_frame.select(list(dict.fromkeys(column for column in ['game_id', 'pos_team', 'def_pos_team', 'text', field, 'play_type', 'yards_gained', 'yds_fg'] if column in frame.columns))).head(5).to_dicts(),
    }
print(json.dumps(summary, indent=2, default=str))
