import os
import shutil
import subprocess
import sys

def check_bash() -> str:
    """
    Locates the bash binary cross-platform.
    Prefers the system PATH, but falls back to common Git installation directories on Windows.
    """
    # see if path is already set
    bash_path = shutil.which("bash")
    if bash_path:
        return bash_path

    # best guess on windows paths
    if sys.platform == "win32":
        common_git_paths = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
            os.path.expanduser(r"~\AppData\Local\Programs\Git\bin\bash.exe")
        ]

        for path in common_git_paths:
            if os.path.exists(path):
                return path

        raise FileNotFoundError(
            "Could not locate bash.exe. Please ensure Git for Windows is installed."
        )

    # Fail if still not found
    raise FileNotFoundError(
        "Could not locate bash. Ensure bash is installed and in the system PATH."
    )

def pybash(
        script_path: str, 
        env_vars: dict | None = None
        ) -> subprocess.CompletedProcess:
    """
    Executes a bash script using the dynamically located bash binary.
    Safely injects secrets via the environment.
    """
    bash_exe = check_bash()
    
    # pass env to child
    run_env = os.environ.copy()
    if env_vars:
        run_env.update(env_vars)

    return subprocess.run(
        [bash_exe, script_path], 
        env=run_env, 
        check=True, 
        text=True, 
        capture_output=True 
    )