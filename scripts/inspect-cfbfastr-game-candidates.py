import json
import sys

import polars as pl

game_id = int(sys.argv[1] if len(sys.argv) > 1 else '401754622')
frame = pl.read_parquet('/tmp/cfbfastR_2025_kst_def_candidates.parquet')
rows = frame.filter(pl.col('game_id').cast(pl.Int64) == game_id).to_dicts()
print(json.dumps(rows, indent=2, default=str))
