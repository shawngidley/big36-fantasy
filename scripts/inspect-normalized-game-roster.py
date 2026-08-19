import polars as pl

frame = pl.read_parquet('/tmp/cfbfastR_2025_first12_game_rosters.parquet')
sample = frame.filter(pl.col('full_name').is_in(['Tommy Castellanos', 'Micahi Danzy', 'Avery Johnson', 'Anthony Colandrea'])).select([
    column for column in ['game_id', 'full_name', 'position_href', 'team_display_name', 'team_abbreviation', 'team_id'] if column in frame.columns
]).head(40)
print(sample.to_dicts())
