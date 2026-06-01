SELECT 
    con.owner,
    con.table_name,
    col.column_name,
    con.constraint_name,
    con.constraint_type,
    CASE con.constraint_type 
        WHEN 'C' THEN 'CHECK'
        WHEN 'P' THEN 'PRIMARY KEY' 
        WHEN 'U' THEN 'UNIQUE' 
        WHEN 'R' THEN 'FOREIGN KEY' 
        WHEN 'V' THEN 'VIEW CHECK OPTION'
        WHEN 'O' THEN 'VIEW READ ONLY'
        WHEN 'F' THEN 'REF COLUMN'
        WHEN 'H' THEN 'HASH EXPRESSION'
        WHEN 'S' THEN 'SUPPLEMENTAL LOGGING'
        ELSE 'UNKNOWN (' || con.constraint_type || ')' 
    END AS constraint_type_desc,
    con.r_owner,
    ac_cols_ref.table_name AS r_table,
    ac_cols_ref.column_name AS r_column,
    con.r_constraint_name,
    con.delete_rule,
    con.status,
    con.deferrable,
    con.deferred,
    con.validated,
    con.generated,
    con.search_condition,
    con.search_condition_vc,
    con.bad,
    con.rely,
    con.last_change,
    con.index_owner,
    con.index_name,
    con.invalid,
    con.view_related,
    con.origin_con_id
FROM all_constraints con
JOIN all_cons_columns col
    ON con.constraint_name = col.constraint_name
    AND con.owner          = col.owner
LEFT JOIN all_cons_columns ac_cols_ref
    ON con.r_constraint_name = ac_cols_ref.constraint_name
    AND con.r_owner          = ac_cols_ref.owner
WHERE con.owner = :schema
AND con.table_name = :table