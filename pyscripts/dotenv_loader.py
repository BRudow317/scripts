from __future__ import annotations
import re, os
from pathlib import Path



def dotenv_loader(config_path: str | Path = "", env: str = "") -> dict[str, str]:
    
    _var = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")

    if not config_path:
        return {}
    path = Path(config_path)
    if not path.is_file():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    raw = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("!") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            raw[key.strip()] = val.strip().strip('"').strip("'")

    lookup = {**os.environ, **raw, "env": env, "ENV": env}

    def interpolate(val: str) -> str:
        previous = None
        loops = 0
        while val != previous and loops < 10:
            previous = val
            def repl(m: re.Match) -> str:
                name = m.group(1) or m.group(2)
                return lookup.get(name, m.group(0))
            
            val = _var.sub(repl, val)
            loops += 1
        return val

    resolved = {k: interpolate(v) for k, v in raw.items()}
    for k, v in list(resolved.items()):
        if v in resolved:
            resolved[k] = resolved[v]
    return resolved