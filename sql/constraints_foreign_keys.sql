SELECT
    ac.owner AS owner,
    ac.table_name AS table_name,
    ac_cols.column_name AS column_name,
    ac.constraint_name AS constraint_name,
    ac.constraint_type AS constraint_type,
    ac.r_owner AS ref_owner,
    ac_cols_ref.table_name AS ref_table,
    ac_cols_ref.column_name AS ref_column,
    ac.r_constraint_name AS ref_constraint_name,
    ac.delete_rule AS delete_rule,
    ac.status AS status
FROM all_constraints ac
JOIN all_cons_columns ac_cols
    ON ac.constraint_name = ac_cols.constraint_name
    AND ac.owner          = ac_cols.owner
JOIN all_cons_columns ac_cols_ref
    ON ac.r_constraint_name = ac_cols_ref.constraint_name
    AND ac.r_owner          = ac_cols_ref.owner

WHERE ac.constraint_type = 'R'
  AND ac.owner = :owner
;