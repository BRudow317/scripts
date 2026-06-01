#!/usr/bin/env bash
# Create QBL schema users inside QBLPDB.
# Idempotent: skips users that already exist.
#
# Required env vars:
#   oracle_sysdba_user, oracle_sysdba_pass, oracle_sysdba_host, oracle_sysdba_port
#   ORACLE_QBLPDB_ADMIN_USER, ORACLE_QBLPDB_ADMIN_PWD
#   ORACLE_QBL_USER, ORACLE_QBL_PWD
#   ORACLE_DWH_USER, ORACLE_DWH_PWD

# Ensure sqlplus is reachable; fall back to oracle_home_path if not on PATH.
if ! command -v sqlplus &>/dev/null; then
    oracle_bin=$(echo "${oracle_home_path}/bin" | sed 's|\\|/|g')
    if [ -f "${oracle_bin}/sqlplus" ] || [ -f "${oracle_bin}/sqlplus.exe" ]; then
        export PATH="${oracle_bin}:${PATH}"
    else
        echo "ERROR: sqlplus not found on PATH or at ${oracle_bin}" >&2
        exit 1
    fi
fi

# Connect as sysdba directly to QBLPDB (not the CDB) so ALTER SESSION SET
# CONTAINER is not needed.
CONN="${oracle_sysdba_user}/${oracle_sysdba_pass}@${oracle_sysdba_host}:${oracle_sysdba_port}/QBLPDB"

echo "Creating schema users in QBLPDB..."

result=$(sqlplus -s "${CONN} as sysdba" <<SQLEOF
SET SERVEROUTPUT ON 
SIZE UNLIMITED 
FEEDBACK OFF;
WHENEVER SQLERROR EXIT SQL.SQLCODE;

DECLARE
  PROCEDURE ensure_user(
    p_user   VARCHAR2,
    p_pass   VARCHAR2,
    p_grants VARCHAR2 DEFAULT 'CONNECT, RESOURCE'
  ) IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM DBA_USERS WHERE USERNAME = UPPER(p_user);
    IF v_count > 0 THEN
      DBMS_OUTPUT.PUT_LINE('SKIP: ' || p_user || ' already exists');
      RETURN;
    END IF;
    EXECUTE IMMEDIATE 'CREATE USER "' || p_user || '" IDENTIFIED BY "' || p_pass || '"';
    EXECUTE IMMEDIATE 'GRANT ' || p_grants || ' TO "' || p_user || '"';
    EXECUTE IMMEDIATE 'ALTER USER "' || p_user || '" QUOTA UNLIMITED ON USERS';
    DBMS_OUTPUT.PUT_LINE('CREATED: ' || p_user);
  END;

BEGIN
  ensure_user('${ORACLE_QBLPDB_ADMIN_USER}', '${ORACLE_QBLPDB_ADMIN_PWD}', 'CONNECT, RESOURCE, DBA');
  ensure_user('${ORACLE_QBL_USER}',          '${ORACLE_QBL_PWD}',          'CONNECT, RESOURCE');
  ensure_user('${ORACLE_DWH_USER}',          '${ORACLE_DWH_PWD}',          'CONNECT, RESOURCE');
  DBMS_OUTPUT.PUT_LINE('Return Code: 0');
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE('ERROR: ' || SQLERRM);
    DBMS_OUTPUT.PUT_LINE('Return Code: 1');
END;
/
EXIT;
SQLEOF
)

echo "$result"

if echo "$result" | grep -q "Return Code: 0"; then
    echo "Schema users ready."
    exit 0
else
    echo "User setup failed."
    exit 1
fi
