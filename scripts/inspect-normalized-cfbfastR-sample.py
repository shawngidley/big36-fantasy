import polars as pl

frame = pl.read_parquet('/tmp/cfbfastR_2025_scoring_plays.parquet')
columns = [
    column for column in [
        'game_id', 'home_team', 'away_team', 'pos_team', 'def_pos_team', 'text',
        'pass_td', 'rush_td', 'passer_player_name', 'rusher_player_name',
        'receiver_player_name', 'start.yardsToEndzone', 'fg_made', 'yds_fg',
        'extra_point_result', 'safety', 'defense_score_play', 'offense_score_play',
    ] if column in frame.columns
]
print(frame.select(columns).head(20).to_dicts())
