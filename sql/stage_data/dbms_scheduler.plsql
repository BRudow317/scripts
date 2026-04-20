BEGIN
    DBMS_SCHEDULER.CREATE_JOB (
        job_name        => 'STAGING_QUEUE_SWEEPER',
        job_type        => 'PLSQL_BLOCK',
        job_action      => 'BEGIN data_processor_pkg.process_queue; END;',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ = SECONDLY; INTERVAL = 60',
        enabled         => TRUE,
        comments        => 'Sweeps the staging table for NEW records'
    );
END;
/

-- Dormatnt Job pattern to avoid heavy i/o overhead for job creation.
BEGIN
    DBMS_SCHEDULER.CREATE_JOB (
        job_name   => 'STAGING_QUEUE_SWEEPER',
        job_type   => 'PLSQL_BLOCK',
        job_action => 'BEGIN data_processor_pkg.process_queue; END;',
        enabled    => TRUE,
        auto_drop  => FALSE -- Keeps the job definition permanently in the database
    );
END;
/

-- Multiple worker thread running concurrently:
BEGIN
    FOR i IN 1..3 LOOP
        DBMS_SCHEDULER.CREATE_JOB (
            job_name   => 'STAGING_QUEUE_SWEEPER_' || i,
            job_type   => 'PLSQL_BLOCK',
            job_action => 'BEGIN data_processor_pkg.process_queue; END;',
            enabled    => TRUE,
            auto_drop  => FALSE 
        );
    END LOOP;
END;
/

DECLARE
    v_job_name VARCHAR2(100);
BEGIN
    DBMS_SCHEDULER.RUN_JOB('STAGING_QUEUE_SWEEPER_'||i, use_current_session => FALSE);
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -27431 THEN NULL;
        ELSE RAISE; -- Real error, raise it
        END IF;
END;
/

--To Make thread safe concurrent workers that avoid collision in the event of duplicates on the target table. 
--package spec
PROCEDURE process_queue (
        worker     IN NUMBER DEFAULT 0, 
        worker_cap IN NUMBER DEFAULT 1
    );

-- The Magic Bullet Cursor
DECLARE
    worker_cap NUMBER := 3; -- Total number of concurrent workers
    worker NUMBER := 0;
    CURSOR c_new_records IS
        SELECT stage_id, id, first_name, last_name, email_addr
        FROM data_staging
        WHERE status = 'NEW'
        -- ORA_HASH ensures the same ID always produces the same bucket number
        AND ORA_HASH(id, worker_cap - 1) = worker
        ORDER BY stage_id ASC -- Guarantees chronological processing
        FOR UPDATE SKIP LOCKED;
    BEGIN
        -- Processing logic here
        -- Worker 0
        FOR i IN worker..worker_cap - 1 LOOP
            DBMS_SCHEDULER.CREATE_JOB (
                job_name   => 'STAGING_QUEUE_SWEEPER_' || i,
                job_type   => 'PLSQL_BLOCK',
                job_action => 'BEGIN data_processor_pkg.process_queue(p_worker_id => '|| i ||', p_total_workers => '||worker_cap||'); END;',
                enabled    => TRUE,
                auto_drop  => FALSE 
            );
        END LOOP;
    END;

    BEGIN
        worker := ORA_HASH(p_id, 2);
        IF worker != p_worker_id THEN
            RETURN; -- Not this worker's bucket, skip it.
        END IF;
    END;
END;