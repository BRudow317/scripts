import sys, subprocess
def install_package(package: str, upgrade: bool = False) -> bool:
    """install_package - Install a package at runtime using pip. So make sure you're in a venv"""
    cmd = [sys.executable, "-m", "pip", "install"]
    if upgrade:
        cmd.append("--upgrade")
    cmd.append(package)
    
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"ok")
        return True
    except subprocess.CalledProcessError as e:
        print(f"fail")
        return False