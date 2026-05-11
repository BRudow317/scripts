import subprocess
import os
import sys
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SQL_CLI_PFX = """
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK;
WHENEVER OSERROR EXIT FAILURE ROLLBACK;
SET SERVEROUTPUT ON;
SET ECHO OFF;
SET FEEDBACK OFF;
"""
SQL_CLI_SFX = " EXIT;"

def connection_string(pgdb: str = "QBL", is_admin: bool = False, as_sysdba: bool = False) -> str:
    env_usr = f"oracle_{pgdb}_user".upper()
    env_pwd = f"oracle_{pgdb}_pwd".upper()
    if is_admin:
        env_usr = f"oracle_{pgdb}pdb_admin_user".upper()
        env_pwd = f"oracle_{pgdb}pdb_admin_pwd".upper()
        
    env_host = f"oracle_{pgdb}_host".upper()
    env_port = f"oracle_{pgdb}_port".upper()
    env_service = f"oracle_{pgdb}_service".upper()

    db_user = os.getenv(env_usr)
    db_pwd = os.getenv(env_pwd)
    if not db_user or not db_pwd:
        raise EnvironmentError(f"Missing required environment variables: {env_usr} and/or {env_pwd}")

    db_host = os.getenv(env_host, "localhost")
    db_pdb = os.getenv(env_service, "QBLPDB")
    db_port = os.getenv(env_port, "1521")

    conn_str = f"{db_user}/{db_pwd}@//{db_host}:{db_port}/{db_pdb}"
    if as_sysdba:
        # sysdba connections often require quotes around the whole string in subprocesses
        conn_str += " AS SYSDBA"
    return conn_str

def get_sql(file_path: str | Path) -> str:
    path_obj = Path(file_path)
    if not path_obj.exists():
        logger.error("File not found: %s", path_obj)
        sys.exit(1)
        
    return path_obj.read_text(encoding="utf-8")

def run_ddl_file(file_path: str | Path, pgdb: str = "QBL", is_admin: bool = False, as_sysdba: bool = False) -> None:

    conn_str = connection_string(pgdb, is_admin, as_sysdba)
    
    raw_sql = get_sql(file_path)

    safe_sql = f"""{SQL_CLI_PFX}{raw_sql}{SQL_CLI_SFX}"""

    command = ["sqlplus", "-s", conn_str]
    
    result = subprocess.run(
        command, 
        input=safe_sql, 
        check=False,
        text=True, 
        capture_output=True
    )

    stdout_upper = result.stdout.upper()
    if (result.returncode != 0 
        or "ORA-" in stdout_upper 
        or "SP2-" in stdout_upper # sqlplus CLI errors
        ):
        logger.error(
            "SQL execution failed in %s:\n%s",
            file_path, 
            result.stdout.strip()
            )
        sys.exit(1)
        
    logger.info("Executed: %s", file_path)

    