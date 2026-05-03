from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

def set_root():
    """ pip install -e . or pip install -e .[dev] will make this available as a package and ensure the root is on sys.path.
    """
    global PROJECT_ROOT
    PROJECT_ROOT = Path(__file__).resolve().parent.parent
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))