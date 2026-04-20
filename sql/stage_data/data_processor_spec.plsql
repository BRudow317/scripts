CREATE OR REPLACE PACKAGE data_processor_pkg AS

    -- Procedure 1: Called by MuleSoft to stage the record and spin off the background job
    PROCEDURE receive_and_stage (
        p_id           IN NUMBER,
        p_first_name   IN VARCHAR2,
        p_middle_name  IN VARCHAR2,
        p_last_name    IN VARCHAR2,
        p_name_prefix  IN VARCHAR2,
        p_name_suffix  IN VARCHAR2,
        p_birthdate    IN DATE,
        p_dt_of_death  IN DATE,
        p_email_type   IN VARCHAR2,
        p_email_addr   IN VARCHAR2,
        p_sex          IN NUMBER,
        p_mar_status   IN NUMBER,
        p_phone_type   IN VARCHAR2,
        p_phone        IN VARCHAR2,
        p_address_type IN VARCHAR2,
        p_address1     IN VARCHAR2,
        p_address2     IN VARCHAR2,
        p_address3     IN VARCHAR2,
        p_address4     IN VARCHAR2,
        p_city         IN VARCHAR2,
        p_state        IN VARCHAR2,
        p_county       IN VARCHAR2,
        p_postal       IN VARCHAR2,
        p_country      IN VARCHAR2
    );

    -- Procedure 2: The background asynchronous worker
    PROCEDURE process_staged_data (p_stage_id IN VARCHAR2);

END data_processor_pkg;
/