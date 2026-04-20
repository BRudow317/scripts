-- 1. Sequences
CREATE SEQUENCE person_seq START WITH 111111 INCREMENT BY 1;
-- The staging sequence remains the same as your previous requirement
CREATE SEQUENCE stg_data_seq START WITH 1 INCREMENT BY 1 MAXVALUE 999999 CYCLE CACHE 20;

-- 2. Staging Table (Unchanged, remains the flat payload receiver)
CREATE TABLE data_staging (
    stage_id        NUMBER GENERATED ALWAYS AS IDENTITY (
                        START WITH 999999 
                        INCREMENT BY 1 
                        CACHE 1000) PRIMARY KEY,
    id              VARCHAR2(9 CHAR) NOT NULL,
    external_key    VARCHAR2(12 CHAR),
    first_name      VARCHAR2(100 CHAR),
    middle_name     VARCHAR2(100 CHAR),
    last_name       VARCHAR2(100 CHAR),
    name_prefix     VARCHAR2(20 CHAR),
    name_suffix     VARCHAR2(20 CHAR),
    birthdate       DATE,
    dt_of_death     DATE,
    email_type      VARCHAR2(50 CHAR),
    email_addr      VARCHAR2(255 CHAR),
    sex             NUMBER,
    mar_status      NUMBER,
    phone_type      VARCHAR2(50 CHAR),
    phone           VARCHAR2(50 CHAR),
    address_type    VARCHAR2(50 CHAR),
    address1        VARCHAR2(255 CHAR),
    address2        VARCHAR2(255 CHAR),
    address3        VARCHAR2(255 CHAR),
    address4        VARCHAR2(255 CHAR),
    city            VARCHAR2(100 CHAR),
    state           VARCHAR2(50 CHAR),
    county          VARCHAR2(100 CHAR),
    postal          VARCHAR2(20 CHAR),
    country         VARCHAR2(50 CHAR),
    created_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at      TIMESTAMP DEFAULT SYSTIMESTAMP,
    created_by      VARCHAR2(100) DEFAULT 'INTEGRATION',
    updated_by      VARCHAR2(100) DEFAULT 'PROCESS',
    integration_id  VARCHAR2(50 CHAR) UNIQUE, 
    status          VARCHAR2(20 CHAR) DEFAULT 'NEW',
    error_msg       VARCHAR2(4000 CHAR)
)
PARTITION BY LIST (status) (
    PARTITION p_new        VALUES ('NEW'),
    PARTITION p_processing VALUES ('PROCESSING'),
    PARTITION p_success    VALUES ('SUCCESS'),
    PARTITION p_error      VALUES ('ERROR')
) ENABLE ROW MOVEMENT;

CREATE INDEX idx_data_staging_id ON data_staging(id);

ALTER TABLE data_staging
ADD CONSTRAINT chk_status_enum
CHECK (status IN ('NEW', 'PROCESSING', 'SUCCESS', 'ERROR'))
;

ALTER TABLE data_staging 
ADD CONSTRAINT fk_status_lookup 
FOREIGN KEY (status_column) REFERENCES status_lookup(status_code);

-- Typical tables allow 1 or 2 concurrent transactions, but this ups that number.
ALTER TABLE data_staging INITRANS 10;

--increased overhead.
-- CREATE OR REPLACE TRIGGER trg_data_staging_id
-- BEFORE INSERT ON data_staging
-- FOR EACH ROW
-- WHEN (new.stage_id IS NULL) -- Only trigger if an ID wasn't provided
-- BEGIN
--     :new.stage_id := TO_CHAR(SYSDATE, 'YYYYMMDDHH24MISS') || TO_CHAR(stg_data_seq.NEXTVAL, 'FM000000');
-- END;
-- /

-- 3. PERSON Table
CREATE TABLE person (
    person_id     VARCHAR2(9) PRIMARY KEY, -- Formatted as 000111111
    id            VARCHAR2(9 CHAR) NOT NULL,
    first_name    VARCHAR2(100),
    middle_name   VARCHAR2(100),
    last_name     VARCHAR2(100),
    name_prefix   VARCHAR2(20),
    name_suffix   VARCHAR2(20),
    birthdate     DATE,
    dt_of_death   DATE,
    email_type    VARCHAR2(50),
    email_addr    VARCHAR2(255),
    sex           NUMBER,
    mar_status    NUMBER,
    -- Audit Columns
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    created_by    VARCHAR2(100) DEFAULT 'SYSTEM',
    updated_by    VARCHAR2(100) DEFAULT 'SYSTEM'
);

-- 4. PHONE Table
CREATE TABLE phone (
    phone_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    person_id     VARCHAR2(9) NOT NULL REFERENCES person(person_id),
    phone_type    VARCHAR2(50),
    phone         VARCHAR2(50),
    -- Audit Columns
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    created_by    VARCHAR2(100) DEFAULT 'SYSTEM',
    updated_by    VARCHAR2(100) DEFAULT 'SYSTEM'
);

-- 5. ADDRESS Table
CREATE TABLE address (
    address_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    person_id     VARCHAR2(9) NOT NULL REFERENCES person(person_id),
    address_type  VARCHAR2(50),
    address1      VARCHAR2(255),
    address2      VARCHAR2(255),
    address3      VARCHAR2(255),
    address4      VARCHAR2(255),
    city          VARCHAR2(100),
    state         VARCHAR2(50),
    county        VARCHAR2(100),
    postal        VARCHAR2(20),
    country       VARCHAR2(50),
    -- Audit Columns
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    updated_at    TIMESTAMP DEFAULT SYSTIMESTAMP,
    created_by    VARCHAR2(100) DEFAULT 'SYSTEM',
    updated_by    VARCHAR2(100) DEFAULT 'SYSTEM'
);