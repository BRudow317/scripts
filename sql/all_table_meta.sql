select t.table_name,
       column_name,
       column_id,
       data_type,
       data_length,
       char_length,
       data_precision,
       data_scale,
       nullable,
       data_default
  from all_tab_columns
 where owner = :owner
   and table_name = :table
 order by table_name,
          column_id;