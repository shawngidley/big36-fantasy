import polars as pl

frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
print(frame.group_by('two_point_conv_result').len().sort('len', descending=True).head(20).to_dicts())
