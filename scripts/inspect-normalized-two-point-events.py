import polars as pl

frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
events = frame.filter(pl.col('two_point_conv_result') == 'success')
columns = [
    column for column in [
        'game_id', 'pos_team', 'text', 'pass_td', 'rush_td', 'passer_player_name',
        'rusher_player_name', 'receiver_player_name', 'two_point_conv_result',
        'start.yardsToEndzone', 'offense_score_play', 'defense_score_play',
    ] if column in events.columns
]
print(events.select(columns).head(40).to_dicts())
