import subprocess
import os

# ex) file_path = "./build/sql/f_qbl_catalog.sql"
def run_sql(file_path: str):
    db_user = os.getenv("ORACLE_QBLPDB_ADMIN_USER")
    db_pwd = os.getenv("ORACLE_QBLPDB_ADMIN_PWD")
    db_host = os.getenv("ORACLE_QBL_HOST", "localhost")
    db_pdb = os.getenv("ORACLE_QBL_SERVICE", "QBLPDB")
    db_port = os.getenv("ORACLE_QBL_PORT", "1521")

    # sqlplus username/password@//localhost:1521/QBLPDB @path_to_file.sql
    command = [
        "sqlplus", 
        "-s", 
        f"{db_user}/{db_pwd}@//{db_host}:{db_port}/{db_pdb}", 
        f"@{file_path}"
    ]
    try:
        result = subprocess.run(command, check=True, text=True, capture_output=True)
        print(result.stdout)
    except subprocess.CalledProcessError as e:
        print(e.stdout)
        print(e.stderr)