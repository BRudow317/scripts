SELECT
    i.table_name,
    ic.column_name,
    i.uniqueness,
    i.constraint_index,
    i.*
FROM all_indexes i
JOIN all_ind_columns ic
    ON i.index_name   = ic.index_name
    AND i.owner       = ic.index_owner
WHERE i.owner       = :owner
  AND i.index_type != 'LOB'
  AND i.generated   = 'N'
  order by i.table_name, ic.column_name
;