MERGE INTO nightly_export_stage tgt
USING (
    -- We select the current array values from DUAL to create a 1-row source table
    SELECT 
        v_batch(i).id         AS int_id,
        v_batch(i).first_name AS fname,
        v_batch(i).last_name  AS lname,
        v_batch(i).birthdate  AS bdate,
        v_batch(i).sex        AS sex
    FROM DUAL
) src
ON (tgt.integration_id = src.int_id) -- Match on their unique FK
WHEN MATCHED THEN
    UPDATE SET 
        tgt.first_name = src.fname,
        tgt.last_name  = src.lname,
        tgt.birthdate  = src.bdate,
        tgt.sex        = src.sex,
        tgt.updated_at = SYSTIMESTAMP,
        tgt.updated_by = 'INTEGRATION_SYNC'
WHEN NOT MATCHED THEN
    INSERT (
        integration_id, 
        first_name, 
        last_name, 
        birthdate, 
        sex, 
        created_at, 
        updated_at, 
        created_by, 
        updated_by
    )
    VALUES (
        src.int_id, 
        src.fname, 
        src.lname, 
        src.bdate, 
        src.sex,
        SYSTIMESTAMP, 
        SYSTIMESTAMP, 
        'INTEGRATION_SYNC', 
        'INTEGRATION_SYNC'
    );