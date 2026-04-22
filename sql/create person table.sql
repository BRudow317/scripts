-- Sequence for the 6-digit suffix
-- Cycles back to 1 after reaching 999999 so your ID never exceeds 20 characters
CREATE SEQUENCE stg_data_seq 
    START WITH 1 
    INCREMENT BY 1 
    MAXVALUE 999999 
    CYCLE 
    CACHE 20;

-- Staging Table tailored to your fields
CREATE TABLE data_staging (
    stage_id      VARCHAR2(20) PRIMARY KEY,
    status        VARCHAR2(20) DEFAULT 'NEW', -- NEW, PROCESSING, PROCESSED, ERROR
    error_msg     VARCHAR2(4000),
    
    -- Your specific payload fields
    id            NUMBER NOT NULL,            -- Non-unique FK
    first_name    VARCHAR2(100),
    middle_name   VARCHAR2(100),
    last_name     VARCHAR2(100),
    name_prefix   VARCHAR2(20),
    name_suffix   VARCHAR2(20),
    birthdate     DATE,
    dt_of_death   DATE,
    email_type    VARCHAR2(50),
    email_addr    VARCHAR2(255),
    sex           NUMBER,                     -- Enum
    mar_status    NUMBER,                     -- Enum
    phone_type    VARCHAR2(50),
    phone         VARCHAR2(50),
    address_type  VARCHAR2(50),
    address1      VARCHAR2(255),
    address2      VARCHAR2(255),
    address3      VARCHAR2(255),
    address4      VARCHAR2(255),
    city          VARCHAR2(100),
    state         VARCHAR2(50),
    county        VARCHAR2(100),
    postal        VARCHAR2(20),
    country       VARCHAR2(50)
);

-- Creating a conceptual target table for the MERGE to compile against
CREATE TABLE target_data (
    record_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fk_id         NUMBER NOT NULL,
    first_name    VARCHAR2(100),
    last_name     VARCHAR2(100),
    email_addr    VARCHAR2(255)
    -- ... other target columns ...
);