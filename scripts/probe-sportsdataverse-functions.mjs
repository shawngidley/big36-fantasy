import { execFileSync } from 'node:child_process';

const python = String.raw`import importlib, inspect, json
module_name = "sportsdataverse.cfb.cfb_pbp"
module = importlib.import_module(module_name)
payload = {
    name: {"signature": str(inspect.signature(func)), "doc": (inspect.getdoc(func) or "").split("\n")[:10]}
    for name, func in inspect.getmembers(module, inspect.isfunction)
    if func.__module__ == module_name
}
print(json.dumps(payload, indent=2))`;

const output = execFileSync('python3', ['-c', python], { encoding: 'utf8' });
console.log(output);
