SELECT 
    con.owner, 
    con.table_name, 
    con.constraint_name, 
    con.constraint_type,
    -- Merges composite columns into a single string
    LISTAGG(col.column_name, ' ') WITHIN GROUP (ORDER BY col.position) AS column_names,
    -- Identifies if it is composite right in the dataset
    CASE 
        WHEN COUNT(col.column_name) OVER(PARTITION BY con.owner, con.constraint_name) > 1 
        THEN 'YES' ELSE 'NO' 
    END AS is_composite,
    con.r_owner, 
    con.r_constraint_name
FROM all_constraints con
JOIN all_cons_columns col 
    ON con.constraint_name = col.constraint_name 
   AND con.owner = col.owner
WHERE con.table_name = :table_name
GROUP BY 
    con.owner, con.table_name, con.constraint_name, con.constraint_type, 
    con.r_owner, con.r_constraint_name
