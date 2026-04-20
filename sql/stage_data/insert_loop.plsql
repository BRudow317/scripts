-- 
INSERT INTO data_staging (
    id, first_name, last_name, birthdate, sex, status
    -- ... all your columns
)
SELECT 
    admin_id, admin_fname, admin_lname, admin_dob, admin_sex, 'NEW'
FROM admin_schema.the_copied_table;

COMMIT; 
-- The moment you commit, the sweeper job will wake up on its next 10-second tick 
-- and begin chewing through the 1 million rows.