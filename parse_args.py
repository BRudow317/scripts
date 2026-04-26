from __future__ import annotations
import argparse

def parse_args(argv, program_name="main") -> argparse.Namespace:
    _env_help_msg=f"Environment (dev01, mmdev, sit01, etc...) NOTE: This is not for .env files, use --config for those."
    _config_help_msg="Path to environment config file with key=value pairs. Values can reference other keys with $KEY or ${KEY} syntax, and can also reference environment variables. See README for details."
    _venv_help_msg = f"Path to venv for the child process (default: inherit caller's environment)"
    _verbose_help_msg = f"Enable debug logging (default: errors and info only)"
    _log_help_msg = f"The folder where the log should be written (default: sys.stdout)"
    _exec_help_msg = f"Child command to run. Must follow all master flags. Usage: {program_name} [flags] --exec python script.py [child args...]"

    parser = argparse.ArgumentParser(prog=program_name, description=f"{program_name}.py - universal pipeline orchestrator", allow_abbrev=False)
    parser.add_argument("--env", dest="env", required=False, type=str, help=_env_help_msg, default="")
    parser.add_argument("--config", "--config_file", "--config-file", dest="config", required=False, type=str, default="", help=_config_help_msg)
    parser.add_argument("--venv", "--venv_dir", "--venv-dir", dest="venv", required=False, type=str, default="", help=_venv_help_msg)
    parser.add_argument("-v", "--verbose", action="store_true", default=False, help=_verbose_help_msg)
    parser.add_argument("-l", "--log", type=str, dest="log_dir", default="sys.stdout",  required=False, help=_log_help_msg)
    parser.add_argument("--exec", nargs=argparse.REMAINDER, default=[], dest="exec", help=_exec_help_msg)
    args = parser.parse_args(argv)
    if not args.exec:
        parser.error(f"Child command required after --exec. Usage:\n  {program_name} [flags] --exec python your_script.py")
    return args