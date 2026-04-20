CREATE OR REPLACE PACKAGE BODY data_processor_pkg AS


    PROCEDURE log_debug(p_source IN VARCHAR2, p_msg IN VARCHAR2, p_clob IN CLOB DEFAULT NULL) IS
        -- PRAGMA AUTONOMOUS_TRANSACTION ensures that even if your main procedure 
        -- crashes and rolls back, your debug logs are still saved to the table!
        PRAGMA AUTONOMOUS_TRANSACTION; 
    BEGIN
        IF g_debug_mode THEN
            INSERT INTO process_debug_log (run_id, source, message, clob_data)
            VALUES (g_test_run_id, p_source, p_msg, p_clob);
            COMMIT;
        END IF;
    END log_debug;
    ----------------------------------------------------------------------------
    -- API 1: SINGLE RECORD INSERT (For the 1000 calls of 1 scenario)
    ----------------------------------------------------------------------------
    PROCEDURE receive_and_stage (
        p_id IN VARCHAR2, p_first_name IN VARCHAR2, p_last_name IN VARCHAR2, 
        p_email_addr IN VARCHAR2 -- ... other 16 vars ...
    ) IS
    BEGIN
        -- Just insert it as fast as possible. NO SCHEDULER CALL HERE.
        INSERT INTO data_staging (
            id, first_name, last_name, email_addr, status
        ) VALUES (
            p_id, p_first_name, p_last_name, p_email_addr, 'NEW'
        );
        COMMIT;
        BEGIN
            -- Trigger the dormant job asynchronously
            DBMS_SCHEDULER.RUN_JOB('STAGING_QUEUE_SWEEPER', use_current_session => FALSE);
            
        EXCEPTION
            WHEN OTHERS THEN
                -- If the job is already running ORA-27431
                IF SQLCODE = -27431 THEN
                    NULL; 
                ELSE
                    RAISE; -- If it's a real error, blow up.
                END IF;
        END;

        EXCEPTION
            WHEN OTHERS THEN
                log_debug('RECEIVE_SINGLE', 'ERROR staging record: ' || SQLERRM, 'ID: ' || p_id);
                RAISE;
    END receive_and_stage;

    ----------------------------------------------------------------------------
    -- API 2: BULK JSON INSERT (For the 1 call of 1000 scenario)
    ----------------------------------------------------------------------------
    -- MuleSoft just passes a JSON array like: [{"id":"123", "first_name":"John"...}, {...}]
    PROCEDURE receive_and_stage_bulk (p_json_payload IN CLOB) IS
    BEGIN
        -- JSON_TABLE shreds the JSON array directly into relational rows incredibly fast
        INSERT INTO data_staging (
            id, first_name, last_name, email_addr, status
        )
        SELECT 
            jt.id, jt.first_name, jt.last_name, jt.email_addr, 'NEW'
        FROM JSON_TABLE(p_json_payload, '$[*]'
            COLUMNS (
                id           VARCHAR2(9)    PATH '$.id',
                first_name   VARCHAR2(100)  PATH '$.first_name',
                last_name    VARCHAR2(100)  PATH '$.last_name',
                email_addr   VARCHAR2(255)  PATH '$.email_addr',
                sex_num        NUMBER        PATH '$.sex' ERROR ON ERROR,
                mar_status_num NUMBER        PATH '$.mar_status' ERROR ON ERROR
                -- ... 
            )
        ) jt;
        
        COMMIT;
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLCODE = -27431 THEN
                    NULL;
                ELSE
                    log_debug('RECEIVE_BULK', 'ERROR processing JSON payload: ' || SQLERRM, p_json_payload);
                    RAISE;
                END IF;
    END receive_and_stage_bulk;

    ----------------------------------------------------------------
    -- THE SWEEPER: Processes records in batches
    ----------------------------------------------------------------
    PROCEDURE process_queue IS
        -- Cursor that safely grabs up to 2000 unhandled rows without locking the table
        CURSOR c_new_records IS
            SELECT stage_id, id, first_name, last_name, email_addr
            FROM data_staging
            WHERE status = 'NEW'
            FOR UPDATE SKIP LOCKED;
            
        -- Define a collection type to hold the batch
        TYPE t_staging_tab IS TABLE OF c_new_records%ROWTYPE;
        v_batch t_staging_tab;
        
    BEGIN
        OPEN c_new_records;
        LOOP
            -- Fetch up to 2000 records at a time
            FETCH c_new_records BULK COLLECT INTO v_batch LIMIT 2000;
            EXIT WHEN v_batch.COUNT = 0;

            -- 2. Loop through the batch and do your relational Upserts/Merges
            FOR i IN 1..v_batch.COUNT LOOP
                BEGIN
                    SAVEPOINT start_of_row;

                    IF g_debug_mode THEN
                        g_processed_ids.EXTEND;
                        g_processed_ids(g_processed_ids.LAST) := v_batch(i).id;
                        log_debug('SWEEPER', 'Processing ID: ' || v_batch(i).id);
                    END IF;
                    -- =========================================================
                    -- NEW: Sync the Nightly Export Table
                    -- =========================================================
                    UPDATE nightly_export_stage
                    SET first_name  = v_batch(i).first_name,
                        last_name   = v_batch(i).last_name,
                        birthdate   = v_batch(i).birthdate,
                        sex         = v_batch(i).sex,
                        -- ... whatever other fields need to match ...
                        updated_at  = SYSTIMESTAMP,
                        updated_by  = 'INTEGRATION_SYNC'
                    WHERE integration_id = v_batch(i).id; -- Match on their FK

                    -- Note: If it's possible the record DOESN'T exist in the nightly 
                    -- table yet, you should use a MERGE statement here instead of an 
                    -- UPDATE so it inserts the row if it's missing.

                    -- =========================================================
                    -- Mark SUCCESS
                    -- =========================================================
                    UPDATE data_staging 
                    SET status = 'SUCCESS' 
                    WHERE stage_id = v_batch(i).stage_id;

                EXCEPTION
                WHEN OTHERS THEN

                        ROLLBACK TO start_of_row;
                        -- If one row fails, mark it ERROR, but let the rest of the batch finish
                        UPDATE data_staging 
                        SET status = 'ERROR', error_msg = SUBSTR(SQLERRM, 1, 4000)
                        WHERE stage_id = v_batch(i).stage_id;
                END;
            END LOOP;
            
            COMMIT;
        END LOOP;
        CLOSE c_new_records;
    END process_queue;

END data_processor_pkg;
/