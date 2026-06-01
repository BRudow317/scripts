#!/usr/bin/env bash
# Create QBLPDB pluggable database.
# Idempotent: exits 0 if PDB already exists.
#
# Required env vars:
#   oracle_sysdba_user, oracle_sysdba_pass, oracle_sysdba_host,
#   oracle_sysdba_port, oracle_sysdba_sid
#   ORACLE_QBLPDB_ADMIN_USER, ORACLE_QBLPDB_ADMIN_PWD

PGDB="QBLPDB"

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

CONN="${oracle_sysdba_user}/${oracle_sysdba_pass}@${oracle_sysdba_host}:${oracle_sysdba_port}/${oracle_sysdba_sid}"

#  Step 1: check if QBLPDB already exists 
echo "Checking for existing ${PGDB}..."

pdb_count=$(sqlplus -s "${CONN} as sysdba" <<'SQLEOF'
SET PAGESIZE 0 
FEEDBACK OFF 
VERIFY OFF 
HEADING OFF 
ECHO OFF 
TRIMSPOOL ON
SELECT COUNT(*) FROM V$PDBS WHERE UPPER(NAME) = UPPER('${PGDB}');
EXIT;
SQLEOF
)

pdb_count=$(echo "$pdb_count" | tr -d '[:space:]')

if [ "${pdb_count:-0}" -gt 0 ] 2>/dev/null; then
    echo "SKIP: ${PGDB} already exists"
    echo "Return Code: 0"
    exit 0
fi

#  Step 2: discover PDB$SEED data file directory 
# Oracle copies PDB$SEED files into the new PDB location — query the actual
# on-disk path rather than hardcoding Docker/Linux paths.
echo "Discovering PDB\$SEED data file path..."

seed_file=$(sqlplus -s "${CONN} as sysdba" <<'SQLEOF'
SET PAGESIZE 0 FEEDBACK OFF VERIFY OFF HEADING OFF ECHO OFF TRIMSPOOL ON
SELECT name FROM v$datafile WHERE con_id = 2 AND rownum = 1;
EXIT;
SQLEOF
)

seed_file=$(echo "$seed_file" | tr -d '\r' | grep -v '^[[:space:]]*$' | head -1 | xargs)

if [ -z "$seed_file" ]; then
    echo "ERROR: Could not determine PDB\$SEED data file path." >&2
    exit 1
fi

# Normalize backslashes so Oracle and bash agree on path separators.
seed_file=$(echo "$seed_file" | sed 's|\\|/|g')
seed_dir=$(dirname "$seed_file")
pgdb_dir=$(dirname "$seed_dir")/${PGDB}

echo "  PDB\$SEED dir : ${seed_dir}"
echo "  ${PGDB} dir   : ${pgdb_dir}"

#  Step 3: create the PDB 
echo "Creating ${PGDB}..."

create_output=$(sqlplus -s "${CONN} as sysdba" <<SQLEOF
SET SERVEROUTPUT ON SIZE UNLIMITED FEEDBACK OFF;

DECLARE
BEGIN
  EXECUTE IMMEDIATE '
    CREATE PLUGGABLE DATABASE ${PGDB}
    ADMIN USER ${ORACLE_QBLPDB_ADMIN_USER} IDENTIFIED BY "${ORACLE_QBLPDB_ADMIN_PWD}"
    FILE_NAME_CONVERT = (''${seed_dir}'', ''${pgdb_dir}'')';

  EXECUTE IMMEDIATE "ALTER PLUGGABLE DATABASE ${PGDB} OPEN";

  -- Persist open state so ${PGDB} reopens automatically after a CDB restart.
  EXECUTE IMMEDIATE "ALTER PLUGGABLE DATABASE ${PGDB} SAVE STATE";

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

echo "$create_output"

if echo "$create_output" | grep -q "Return Code: 0"; then
    echo "${PGDB} created, opened, and state saved."
    exit 0
else
    echo "${PGDB} creation failed."
    exit 1
fi
