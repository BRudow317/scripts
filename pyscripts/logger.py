import logging, os, sys
from pathlib import Path
from datetime import datetime

PROGRAM_NAME = os.getenv("PROGRAM_NAME", "boot")
if PROGRAM_NAME == "boot":
    os.environ["PROGRAM_NAME"] = PROGRAM_NAME

_LOG_FORMAT = '%(asctime)s [%(levelname)s] %(name)s: %(message)s'

def setup_logging(
        log_dir: str = "sys.stdout",
        verbose: bool = True,
        program_name: str = PROGRAM_NAME
        ) -> tuple[logging.Logger, Path | None]:
    level = logging.DEBUG if verbose else logging.INFO
    formatter = logging.Formatter(_LOG_FORMAT)
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    root.addHandler(console)

    logfile: Path | None = None
    if log_dir and log_dir != 'sys.stdout':
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        logfile = path / f"{datetime.now():%Y_%m_%d_%H_%M_%S}_{program_name}.log"
        fh = logging.FileHandler(logfile)
        fh.setFormatter(formatter)
        root.addHandler(fh)
    
    return logging.getLogger(program_name), logfile