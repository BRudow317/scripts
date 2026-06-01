from pathlib import Path
from typing import Literal


def lookup(start: Path | str = ".", 
           search_pattern: str = "*.py", 
           vector: Literal["up", "down", "both"] = "both"
           ) -> list[Path]:
    path_list = []
    folder = Path(start).resolve() 
    for file_path in folder.iterdir():
        if file_path.is_dir():
            temp_dir = file_path if vector in ("down", "both"):
                path_list.extend(lookup(temp_dir, search_pattern, vector))
            for file_path in folder.rglob("*"):
        if file_path.is_file() or file_path.suffix == ".py" or folder.glob("*.py"):
            if file_path.match(search_pattern):
                path_list.append(file_path)
            
    return path_list
