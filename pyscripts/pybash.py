import os
import shutil
import subprocess
import sys
from pathlib import Path

def check_bash() -> str:
    bash_path = shutil.which("bash")
    if bash_path:
        return bash_path
    
    if sys.platform == "win32":
        git_bash_paths = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
            os.path.expanduser(r"~\AppData\Local\Programs\Git\bin\bash.exe"),
        ]
        for path in git_bash_paths:
            if os.path.exists(path):
                return path  
    raise FileNotFoundError(
        "Could not locate bash."
    )

def pybash(
        script_path: str|Path
        ) -> subprocess.CompletedProcess:
    script_path = Path(script_path).resolve()
    if not script_path.is_file():
        raise FileNotFoundError(f"Script not found: {script_path}")
    bash_exe = check_bash()
    run_env = os.environ.copy()
    return subprocess.run(
        [bash_exe, str(script_path)],
        env=run_env,
        check=True,
        text=True,
        capture_output=True,
    )