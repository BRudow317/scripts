----------------------------------------------------------------------------
-- THE TEST HARNESS
----------------------------------------------------------------------------
PROCEDURE run_unit_tests IS
    v_mock_json CLOB;
    v_nightly_count NUMBER;
BEGIN
    -- 1. Enable Debug Mode and set a Run ID
    g_debug_mode := TRUE;
    g_test_run_id := 'TEST_' || TO_CHAR(SYSDATE, 'HH24MISS');
    g_processed_ids.DELETE; -- Clear the array from previous runs
    
    log_debug('TEST_HARNESS', 'Starting Unit Test Run');

    -- 2. Setup: Clear staging so we have a clean slate (Dev environment only!)
    DELETE FROM data_staging;
    
    -- 3. Simulate MuleSoft Call
    v_mock_json := '[{"id":"999111", "first_name":"Testy", "last_name":"McTest", "birthdate":"1985-05-05"}]';
    log_debug('TEST_HARNESS', 'Injecting mock payload', v_mock_json);
    receive_and_stage_bulk(v_mock_json);
    
    -- 4. FORCE the Sweeper to run synchronously right now
    log_debug('TEST_HARNESS', 'Manually triggering process_queue');
    process_queue();
    
    -- 5. Inspect the retained global variables
    IF g_processed_ids.COUNT > 0 THEN
        log_debug('TEST_HARNESS', 'Retained memory shows ' || g_processed_ids.COUNT || ' IDs were touched.');
    END IF;

    -- 6. Simulate the Nightly Job Conflict
    log_debug('TEST_HARNESS', 'Simulating Nightly Job Run...');
    -- (Call your nightly job procedure here, or write the mock SQL it uses)
    
    -- 7. Assertions (Did it work?)
    SELECT COUNT(*) INTO v_nightly_count 
    FROM nightly_export_stage 
    WHERE integration_id = '999111';
    
    IF v_nightly_count = 1 THEN
        log_debug('TEST_HARNESS', 'SUCCESS: Record successfully survived into the nightly table.');
    ELSE
        log_debug('TEST_HARNESS', 'FAIL: Record did not make it to the nightly table.');
    END IF;

    -- 8. Clean up (Turn debug off so you don't accidentally leave it on)
    g_debug_mode := FALSE;
    
EXCEPTION
    WHEN OTHERS THEN
        log_debug('TEST_HARNESS', 'TEST CRASHED: ' || SQLERRM);
        g_debug_mode := FALSE;
        RAISE;
END run_unit_tests;

BEGIN
    data_processor_pkg.run_unit_tests;
END;
