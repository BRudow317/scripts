
import os


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