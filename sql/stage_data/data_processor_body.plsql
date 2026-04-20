CREATE OR REPLACE PACKAGE BODY data_processor_pkg AS

    ----------------------------------------------------------------------------
    -- PROCEDURE 1: Staging (Remains essentially the same)
    ----------------------------------------------------------------------------
    PROCEDURE receive_and_stage (
        p_id IN NUMBER, p_first_name IN VARCHAR2, p_middle_name IN VARCHAR2, p_last_name IN VARCHAR2,
        p_name_prefix IN VARCHAR2, p_name_suffix IN VARCHAR2, p_birthdate IN DATE, p_dt_of_death IN DATE,
        p_email_type IN VARCHAR2, p_email_addr IN VARCHAR2, p_sex IN NUMBER, p_mar_status IN NUMBER,
        p_phone_type IN VARCHAR2, p_phone IN VARCHAR2, p_address_type IN VARCHAR2, p_address1 IN VARCHAR2,
        p_address2 IN VARCHAR2, p_address3 IN VARCHAR2, p_address4 IN VARCHAR2, p_city IN VARCHAR2,
        p_state IN VARCHAR2, p_county IN VARCHAR2, p_postal IN VARCHAR2, p_country IN VARCHAR2
    ) IS
        v_stage_id VARCHAR2(20);
        v_job_name VARCHAR2(100);
    BEGIN
        v_stage_id := TO_CHAR(SYSDATE, 'YYYYMMDDHH24MISS') || TO_CHAR(stg_data_seq.NEXTVAL, 'FM000000');

        INSERT INTO data_staging (
            stage_id, status, id, first_name, middle_name, last_name, name_prefix, name_suffix, 
            birthdate, dt_of_death, email_type, email_addr, sex, mar_status, phone_type, phone, 
            address_type, address1, address2, address3, address4, city, state, county, postal, country
        ) VALUES (
            v_stage_id, 'NEW', p_id, p_first_name, p_middle_name, p_last_name, p_name_prefix, p_name_suffix, 
            p_birthdate, p_dt_of_death, p_email_type, p_email_addr, p_sex, p_mar_status, p_phone_type, p_phone, 
            p_address_type, p_address1, p_address2, p_address3, p_address4, p_city, p_state, p_county, p_postal, p_country
        );
        COMMIT;

        v_job_name := 'STG_PROC_' || v_stage_id;
        DBMS_SCHEDULER.CREATE_JOB (
            job_name   => v_job_name,
            job_type   => 'PLSQL_BLOCK',
            job_action => 'BEGIN data_processor_pkg.process_staged_data(''' || v_stage_id || '''); END;',
            start_date => SYSTIMESTAMP,
            enabled    => TRUE,
            auto_drop  => TRUE
        );
    END receive_and_stage;

    ----------------------------------------------------------------------------
    -- PROCEDURE 2: Relational Processing 
    ----------------------------------------------------------------------------
    PROCEDURE process_staged_data (p_stage_id IN VARCHAR2) IS
        v_row       data_staging%ROWTYPE;
        v_person_id VARCHAR2(9);
        v_err_msg   VARCHAR2(4000);
        v_user      VARCHAR2(100) := 'MULESOFT_INT'; -- The audit user
    BEGIN
        UPDATE data_staging SET status = 'PROCESSING' WHERE stage_id = p_stage_id;
        COMMIT;

        SELECT * INTO v_row FROM data_staging WHERE stage_id = p_stage_id;

        -- =====================================================================
        -- 1. UPSERT PERSON (using explicit Select/Update/Insert to capture PK)
        -- =====================================================================
        BEGIN
            -- Attempt to find existing person. (Using ID and Email as a composite match here)
            SELECT person_id INTO v_person_id 
            FROM person 
            WHERE id = v_row.id AND email_addr = v_row.email_addr;

            -- If found, update
            UPDATE person SET 
                first_name = v_row.first_name, middle_name = v_row.middle_name, last_name = v_row.last_name,
                name_prefix = v_row.name_prefix, name_suffix = v_row.name_suffix, birthdate = v_row.birthdate,
                dt_of_death = v_row.dt_of_death, email_type = v_row.email_type, sex = v_row.sex, mar_status = v_row.mar_status,
                updated_at = SYSTIMESTAMP, updated_by = v_user
            WHERE person_id = v_person_id;

        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                -- If not found, generate the padded 9-digit PK and insert
                v_person_id := LPAD(person_seq.NEXTVAL, 9, '0');
                
                INSERT INTO person (
                    person_id, id, first_name, middle_name, last_name, name_prefix, name_suffix,
                    birthdate, dt_of_death, email_type, email_addr, sex, mar_status,
                    created_by, updated_by
                ) VALUES (
                    v_person_id, v_row.id, v_row.first_name, v_row.middle_name, v_row.last_name, v_row.name_prefix, v_row.name_suffix,
                    v_row.birthdate, v_row.dt_of_death, v_row.email_type, v_row.email_addr, v_row.sex, v_row.mar_status,
                    v_user, v_user
                );
        END;

        -- =====================================================================
        -- 2. MERGE PHONE (Matching on person_id + phone_type)
        -- =====================================================================
        IF v_row.phone IS NOT NULL THEN
            MERGE INTO phone p
            USING (SELECT v_person_id AS pid, v_row.phone_type AS pt, v_row.phone AS ph FROM DUAL) s
            ON (p.person_id = s.pid AND p.phone_type = s.pt)
            WHEN MATCHED THEN
                UPDATE SET phone = s.ph, updated_at = SYSTIMESTAMP, updated_by = v_user
            WHEN NOT MATCHED THEN
                INSERT (person_id, phone_type, phone, created_by, updated_by)
                VALUES (s.pid, s.pt, s.ph, v_user, v_user);
        END IF;

        -- =====================================================================
        -- 3. MERGE ADDRESS (Matching on person_id + address_type)
        -- =====================================================================
        IF v_row.address1 IS NOT NULL OR v_row.city IS NOT NULL THEN
            MERGE INTO address a
            USING (
                SELECT v_person_id AS pid, v_row.address_type AS atype, v_row.address1 AS a1, 
                       v_row.address2 AS a2, v_row.address3 AS a3, v_row.address4 AS a4, 
                       v_row.city AS ct, v_row.state AS st, v_row.county AS co, 
                       v_row.postal AS po, v_row.country AS cy 
                FROM DUAL
            ) s
            ON (a.person_id = s.pid AND a.address_type = s.atype)
            WHEN MATCHED THEN
                UPDATE SET 
                    address1 = s.a1, address2 = s.a2, address3 = s.a3, address4 = s.a4,
                    city = s.ct, state = s.st, county = s.co, postal = s.po, country = s.cy,
                    updated_at = SYSTIMESTAMP, updated_by = v_user
            WHEN NOT MATCHED THEN
                INSERT (person_id, address_type, address1, address2, address3, address4, city, state, county, postal, country, created_by, updated_by)
                VALUES (s.pid, s.atype, s.a1, s.a2, s.a3, s.a4, s.ct, s.st, s.co, s.po, s.cy, v_user, v_user);
        END IF;

        -- =====================================================================
        -- 4. Mark Success
        -- =====================================================================
        UPDATE data_staging SET status = 'PROCESSED' WHERE stage_id = p_stage_id;
        COMMIT;

    EXCEPTION
        WHEN OTHERS THEN
            v_err_msg := SUBSTR(SQLERRM, 1, 4000);
            ROLLBACK;
            UPDATE data_staging SET status = 'ERROR', error_msg = v_err_msg WHERE stage_id = p_stage_id;
            COMMIT;
    END process_staged_data;

END data_processor_pkg;
/