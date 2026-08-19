import json
from pathlib import Path

import polars as pl

frame = pl.read_parquet('/tmp/cfbfastR_2025_kst_def_candidates.parquet')
available = frame.columns
sample = frame.filter(
    pl.col('sack_player_name').is_not_null()
    | pl.col('interception_player_name').is_not_null()
    | pl.col('fumble_recovered_player_name').is_not_null()
    | pl.col('defense_score_play').fill_null(False)
    | pl.col('safety').fill_null(False)
).select(available).head(40).to_dicts()
print(json.dumps({'columns': available, 'sample': sample}, indent=2, default=str))
