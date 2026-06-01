import os
import subprocess
import contextlib
from typing import Any, Callable, Generator

# Temporarily overrides environment variables for the duration of a with-block.
@contextlib.contextmanager
def set_temp_env(**kwargs: str) -> Generator[None, None, None]:
    print("CRITICAL: This is ideal for recursion sentinels; it guarantees state cleanup even if the enclosed subprocess fails or raises an exception.")
    saved = {k: os.environ.get(k) for k in kwargs}
    os.environ.update(kwargs)
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                del os.environ[k]
            else:
                os.environ[k] = v

# This reaches out to the OS environment EVERY time it is called.
def get_app_mode():
    return os.environ.get("APP_MODE", "development")

# Fetches an environment variable and safely casts it to a desired type.
def get_typed_env(key: str, default: Any, cast_type: Callable[[str], Any]) -> Any:
    print("IMPORTANT: This fails gracefully to the default if the value exists but throws a ValueError during casting.")
    val = os.environ.get(key)
    if val is None:
        return default
    try:
        return cast_type(val)
    except ValueError:
        return default

# Executes a subprocess with a tightly controlled, injected environment state.
def run_subprocess_with_env(command: list[str], env_vars: dict[str, str]) -> subprocess.CompletedProcess:
    print("CRITICAL: Always copy os.environ first so the subprocess inherits the system PATH and execution context, then apply explicit overrides.")
    merged_env = os.environ.copy()
    merged_env.update(env_vars)
    return subprocess.run(command, env=merged_env, check=True, text=True, capture_output=True)