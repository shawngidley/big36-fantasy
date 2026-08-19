import json
import sportsdataverse

names = sorted(
    name
    for name in dir(sportsdataverse)
    if name.startswith(("espn_cfb", "cfb_ncaa", "parse_cfb_ncaa"))
)

print(json.dumps({"version": getattr(sportsdataverse, "__version__", None), "candidates": names}, indent=2))
