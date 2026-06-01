-- =============================================================================
-- json_obj  --  Oracle 19c JSON object wrapper
-- =============================================================================
-- Target:   Oracle Database 19c
-- Requires: Oracle 12.2+ PL/SQL JSON type hierarchy (JSON_ELEMENT_T,
--           JSON_OBJECT_T, JSON_ARRAY_T, JSON_KEY_LIST)
--
-- Changes from original:
--   1. Removed json_transform: that function requires Oracle 21c and is not
--      available in 19c.
--   2. Fixed json_serialize(p_pretty) and json_serialize_clob(p_pretty):
--      the original ignored p_pretty and always pretty-printed.  Now branches
--      on UPPER(p_pretty) = 'PRETTY'.
--   3. Added json_query_clob(p_path): CLOB-returning overload of json_query
--      for results that may exceed 4000 characters.
--   4. Fixed omit: replaced O(n*m) nested loop with an index-by table for
--      O(1) skip-set lookup.
--   5. Added EXCEPTION handlers to all four static functions (json_object,
--      json_objectagg, json_array, json_arrayagg) with descriptive messages
--      hinting at the RETURNING BLOB requirement.
--   6. Documented map_key limitation (key-insertion-order sensitivity).
--   7. Documented parse-on-every-access performance characteristic with
--      a recommended workaround for bulk-mutation scenarios.
--
-- Security note: json_value, json_query, json_query_clob, and json_exists
--   all concatenate p_path into dynamic SQL after single-quote escaping.
--   Always pass application-controlled path strings; never pass raw user input.
-- =============================================================================


-- =============================================================================
-- TYPE SPEC
-- =============================================================================

CREATE OR REPLACE TYPE json_obj AS OBJECT (

    raw_json  BLOB,   -- UTF-8 / AL32UTF8 encoded JSON document

    -- ── Constructors ──────────────────────────────────────────────────────────
    CONSTRUCTOR FUNCTION json_obj RETURN SELF AS RESULT,
    CONSTRUCTOR FUNCTION json_obj(p_json IN VARCHAR2)       RETURN SELF AS RESULT,
    CONSTRUCTOR FUNCTION json_obj(p_json IN CLOB)           RETURN SELF AS RESULT,
    CONSTRUCTOR FUNCTION json_obj(p_json IN BLOB)           RETURN SELF AS RESULT,
    CONSTRUCTOR FUNCTION json_obj(p_json IN JSON_ELEMENT_T) RETURN SELF AS RESULT,  -- raises ORA-20001 if not an object

    -- ── PL/SQL — JSON_OBJECT_T.put ────────────────────────────────────────────
    -- NOTE: each put/remove/rename call parses raw_json and re-serializes.
    --       For multiple sequential mutations, work directly with JSON_OBJECT_T
    --       in your own PL/SQL block and construct a single new json_obj at
    --       the end to avoid redundant parse/serialize cycles.
    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN VARCHAR2),
    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN NUMBER),
    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN DATE),
    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN TIMESTAMP),
    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN JSON_ELEMENT_T),
    MEMBER PROCEDURE put_bool(p_key IN VARCHAR2, p_val IN VARCHAR2),  -- BOOLEAN disallowed in SQL type spec; pass 'true'|'false'
    MEMBER PROCEDURE put_null(p_key IN VARCHAR2),
    MEMBER PROCEDURE put_obj (p_key IN VARCHAR2, p_doc IN json_obj),
    MEMBER PROCEDURE put_arr (p_key IN VARCHAR2, p_arr IN JSON_ARRAY_T),

    -- ── PL/SQL — JSON_OBJECT_T.remove / rename_key ───────────────────────────
    MEMBER PROCEDURE remove(p_key IN VARCHAR2),
    MEMBER PROCEDURE rename_key(p_old IN VARCHAR2, p_new IN VARCHAR2),

    -- ── PL/SQL — JSON_OBJECT_T.get_* ─────────────────────────────────────────
    MEMBER FUNCTION get          (p_key IN VARCHAR2) RETURN JSON_ELEMENT_T,
    MEMBER FUNCTION get_string   (p_key IN VARCHAR2) RETURN VARCHAR2,
    MEMBER FUNCTION get_number   (p_key IN VARCHAR2) RETURN NUMBER,
    MEMBER FUNCTION get_boolean  (p_key IN VARCHAR2) RETURN VARCHAR2,   -- returns 'true'|'false'|NULL
    MEMBER FUNCTION get_date     (p_key IN VARCHAR2) RETURN DATE,
    MEMBER FUNCTION get_timestamp(p_key IN VARCHAR2) RETURN TIMESTAMP,
    MEMBER FUNCTION get_clob     (p_key IN VARCHAR2) RETURN CLOB,
    MEMBER FUNCTION get_blob     (p_key IN VARCHAR2) RETURN BLOB,
    MEMBER FUNCTION get_object   (p_key IN VARCHAR2) RETURN json_obj,
    MEMBER FUNCTION get_array    (p_key IN VARCHAR2) RETURN JSON_ARRAY_T,

    -- ── PL/SQL — JSON_OBJECT_T introspection ─────────────────────────────────
    MEMBER FUNCTION has      (p_key IN VARCHAR2) RETURN VARCHAR2,  -- 'Y'|'N'
    MEMBER FUNCTION get_type (p_key IN VARCHAR2) RETURN VARCHAR2,  -- 'string'|'number'|'boolean'|'null'|'array'|'object'
    MEMBER FUNCTION get_keys  RETURN JSON_KEY_LIST,
    MEMBER FUNCTION get_size  RETURN NUMBER,
    MEMBER FUNCTION clone     RETURN json_obj,

    -- ── PL/SQL — JSON_OBJECT_T serialization ─────────────────────────────────
    MEMBER FUNCTION to_string RETURN VARCHAR2,
    MEMBER FUNCTION to_clob   RETURN CLOB,
    MEMBER FUNCTION to_blob   RETURN BLOB,

    -- ── Utilities not in Oracle stdlib ────────────────────────────────────────
    MEMBER PROCEDURE merge_in(p_other IN json_obj),                    -- shallow key copy; p_other wins on conflict
    MEMBER FUNCTION pick(p_keys IN SYS.ODCIVARCHAR2LIST) RETURN json_obj,
    MEMBER FUNCTION omit(p_keys IN SYS.ODCIVARCHAR2LIST) RETURN json_obj,

    -- ── SQL — json_value ──────────────────────────────────────────────────────
    -- p_path concatenated into dynamic SQL after single-quote escaping.
    -- Pass only application-controlled strings; never raw user input.
    MEMBER FUNCTION json_value(p_path IN VARCHAR2) RETURN VARCHAR2,

    -- ── SQL — json_query ──────────────────────────────────────────────────────
    -- p_path concatenated into dynamic SQL after single-quote escaping.
    -- Pass only application-controlled strings; never raw user input.
    -- Use json_query_clob when the result may exceed 4000 characters.
    MEMBER FUNCTION json_query     (p_path IN VARCHAR2) RETURN VARCHAR2,  -- WITH ARRAY WRAPPER; max ~4000 chars
    MEMBER FUNCTION json_query_clob(p_path IN VARCHAR2) RETURN CLOB,      -- WITH ARRAY WRAPPER; no length limit

    -- ── SQL — json_exists ─────────────────────────────────────────────────────
    -- p_path concatenated into dynamic SQL after single-quote escaping.
    -- Pass only application-controlled strings; never raw user input.
    MEMBER FUNCTION json_exists(p_path IN VARCHAR2) RETURN VARCHAR2,  -- 'Y'|'N'

    -- ── SQL — json_serialize ──────────────────────────────────────────────────
    -- json_table: pass doc.raw_json directly to json_table() in SQL
    MEMBER FUNCTION json_serialize                              RETURN VARCHAR2,
    MEMBER FUNCTION json_serialize(p_pretty IN VARCHAR2)       RETURN VARCHAR2,  -- pass 'PRETTY' to indent output
    MEMBER FUNCTION json_serialize_clob                        RETURN CLOB,
    MEMBER FUNCTION json_serialize_clob(p_pretty IN VARCHAR2)  RETURN CLOB,      -- pass 'PRETTY' to indent output

    -- ── SQL — json_equal ──────────────────────────────────────────────────────
    MEMBER FUNCTION json_equal(p_other IN json_obj) RETURN VARCHAR2,  -- 'Y'|'N'

    -- ── SQL — json_mergepatch ─────────────────────────────────────────────────
    MEMBER PROCEDURE json_mergepatch(p_patch IN VARCHAR2),
    MEMBER PROCEDURE json_mergepatch(p_patch IN json_obj),

    -- ── SQL — json_object / json_objectagg (static) ───────────────────────────
    -- p_sql: full SELECT statement returning a single BLOB column.
    -- The JSON_OBJECT / JSON_OBJECTAGG call in your SELECT must include
    -- RETURNING BLOB.  Raises ORA-20002 with a descriptive message otherwise.
    STATIC FUNCTION json_object   (p_sql IN VARCHAR2) RETURN json_obj,
    STATIC FUNCTION json_objectagg(p_sql IN VARCHAR2) RETURN json_obj,

    -- ── SQL — json_array / json_arrayagg (static) ─────────────────────────────
    -- p_sql: full SELECT statement returning a single BLOB column.
    -- The JSON_ARRAY / JSON_ARRAYAGG call in your SELECT must include
    -- RETURNING BLOB.  Raises ORA-20002 with a descriptive message otherwise.
    STATIC FUNCTION json_array   (p_sql IN VARCHAR2) RETURN JSON_ARRAY_T,
    STATIC FUNCTION json_arrayagg(p_sql IN VARCHAR2) RETURN JSON_ARRAY_T,

    -- ── MAP ───────────────────────────────────────────────────────────────────
    -- NOTE: map_key serializes the full document for SQL collection ordering
    --       and equality comparisons.  Two objects with the same keys and
    --       values but different insertion order will compare as unequal.
    --       Do not rely on natural ordering of json_obj in SQL collection
    --       contexts where key insertion order is not stable.
    MAP MEMBER FUNCTION map_key RETURN VARCHAR2

) NOT FINAL;
/


-- =============================================================================
-- TYPE BODY
-- =============================================================================

CREATE OR REPLACE TYPE BODY json_obj AS

    -- ── Constructors ──────────────────────────────────────────────────────────

    CONSTRUCTOR FUNCTION json_obj RETURN SELF AS RESULT IS
        v_obj JSON_OBJECT_T;
    BEGIN
        v_obj := new JSON_OBJECT_T; SELF.raw_json := v_obj.to_Blob; RETURN;
    END;

    CONSTRUCTOR FUNCTION json_obj(p_json IN VARCHAR2) RETURN SELF AS RESULT IS
    BEGIN
        SELF.raw_json := JSON_OBJECT_T.parse(p_json).to_Blob; RETURN;
    END;

    CONSTRUCTOR FUNCTION json_obj(p_json IN CLOB) RETURN SELF AS RESULT IS
    BEGIN
        SELF.raw_json := JSON_OBJECT_T.parse(p_json).to_Blob; RETURN;
    END;

    CONSTRUCTOR FUNCTION json_obj(p_json IN BLOB) RETURN SELF AS RESULT IS
    BEGIN
        SELF.raw_json := JSON_OBJECT_T.parse(p_json).to_Blob; RETURN;
    END;

    CONSTRUCTOR FUNCTION json_obj(p_json IN JSON_ELEMENT_T) RETURN SELF AS RESULT IS
    BEGIN
        IF p_json.is_Array  THEN RAISE_APPLICATION_ERROR(-20001, 'json_obj requires a JSON object; received an array.');  END IF;
        IF p_json.is_Scalar THEN RAISE_APPLICATION_ERROR(-20001, 'json_obj requires a JSON object; received a scalar.'); END IF;
        SELF.raw_json := treat(p_json AS JSON_OBJECT_T).to_Blob; RETURN;
    END;

    -- ── PL/SQL put ────────────────────────────────────────────────────────────

    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN VARCHAR2) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.put(p_key,p_val); SELF.raw_json := v.to_Blob; END;

    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN NUMBER) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.put(p_key,p_val); SELF.raw_json := v.to_Blob; END;

    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN DATE) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.put(p_key,p_val); SELF.raw_json := v.to_Blob; END;

    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN TIMESTAMP) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.put(p_key,p_val); SELF.raw_json := v.to_Blob; END;

    MEMBER PROCEDURE put(p_key IN VARCHAR2, p_val IN JSON_ELEMENT_T) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.put(p_key,p_val); SELF.raw_json := v.to_Blob; END;

    MEMBER PROCEDURE put_bool(p_key IN VARCHAR2, p_val IN VARCHAR2) IS
        v JSON_OBJECT_T;
    BEGIN
        v := JSON_OBJECT_T.parse(SELF.raw_json);
        v.put(p_key, CASE LOWER(p_val) WHEN 'true' THEN TRUE ELSE FALSE END);
        SELF.raw_json := v.to_Blob;
    END;

    MEMBER PROCEDURE put_null(p_key IN VARCHAR2) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.put_Null(p_key); SELF.raw_json := v.to_Blob; END;

    MEMBER PROCEDURE put_obj(p_key IN VARCHAR2, p_doc IN json_obj) IS
        v JSON_OBJECT_T;
    BEGIN
        v := JSON_OBJECT_T.parse(SELF.raw_json);
        v.put(p_key, JSON_OBJECT_T.parse(p_doc.raw_json));
        SELF.raw_json := v.to_Blob;
    END;

    MEMBER PROCEDURE put_arr(p_key IN VARCHAR2, p_arr IN JSON_ARRAY_T) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.put(p_key,p_arr); SELF.raw_json := v.to_Blob; END;

    -- ── PL/SQL modify ─────────────────────────────────────────────────────────

    MEMBER PROCEDURE remove(p_key IN VARCHAR2) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.remove(p_key); SELF.raw_json := v.to_Blob; END;

    MEMBER PROCEDURE rename_key(p_old IN VARCHAR2, p_new IN VARCHAR2) IS
        v JSON_OBJECT_T;
    BEGIN v := JSON_OBJECT_T.parse(SELF.raw_json); v.rename_Key(p_old,p_new); SELF.raw_json := v.to_Blob; END;

    -- ── PL/SQL get ────────────────────────────────────────────────────────────

    MEMBER FUNCTION get(p_key IN VARCHAR2) RETURN JSON_ELEMENT_T IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get(p_key); END;

    MEMBER FUNCTION get_string(p_key IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_String(p_key); END;

    MEMBER FUNCTION get_number(p_key IN VARCHAR2) RETURN NUMBER IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Number(p_key); END;

    MEMBER FUNCTION get_boolean(p_key IN VARCHAR2) RETURN VARCHAR2 IS
        b BOOLEAN;
    BEGIN
        b := JSON_OBJECT_T.parse(SELF.raw_json).get_Boolean(p_key);
        RETURN CASE b WHEN TRUE THEN 'true' WHEN FALSE THEN 'false' ELSE NULL END;
    END;

    MEMBER FUNCTION get_date(p_key IN VARCHAR2) RETURN DATE IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Date(p_key); END;

    MEMBER FUNCTION get_timestamp(p_key IN VARCHAR2) RETURN TIMESTAMP IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Timestamp(p_key); END;

    MEMBER FUNCTION get_clob(p_key IN VARCHAR2) RETURN CLOB IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Clob(p_key); END;

    MEMBER FUNCTION get_blob(p_key IN VARCHAR2) RETURN BLOB IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Blob(p_key); END;

    MEMBER FUNCTION get_object(p_key IN VARCHAR2) RETURN json_obj IS
    BEGIN RETURN new json_obj(JSON_OBJECT_T.parse(SELF.raw_json).get_Object(p_key).to_Blob); END;

    MEMBER FUNCTION get_array(p_key IN VARCHAR2) RETURN JSON_ARRAY_T IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Array(p_key); END;

    -- ── PL/SQL introspection ──────────────────────────────────────────────────

    MEMBER FUNCTION has(p_key IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN CASE JSON_OBJECT_T.parse(SELF.raw_json).has(p_key) WHEN TRUE THEN 'Y' ELSE 'N' END; END;

    MEMBER FUNCTION get_type(p_key IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Type(p_key); END;

    MEMBER FUNCTION get_keys RETURN JSON_KEY_LIST IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Keys; END;

    MEMBER FUNCTION get_size RETURN NUMBER IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).get_Size; END;

    MEMBER FUNCTION clone RETURN json_obj IS
    BEGIN RETURN new json_obj(SELF.raw_json); END;

    -- ── PL/SQL serialization ──────────────────────────────────────────────────

    MEMBER FUNCTION to_string RETURN VARCHAR2 IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).to_String; END;

    MEMBER FUNCTION to_clob RETURN CLOB IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).to_Clob; END;

    MEMBER FUNCTION to_blob RETURN BLOB IS
    BEGIN RETURN SELF.raw_json; END;

    -- ── Utilities ─────────────────────────────────────────────────────────────

    MEMBER PROCEDURE merge_in(p_other IN json_obj) IS
        vb  JSON_OBJECT_T;
        vo  JSON_OBJECT_T;
        vk  JSON_KEY_LIST;
    BEGIN
        vb := JSON_OBJECT_T.parse(SELF.raw_json);
        vo := JSON_OBJECT_T.parse(p_other.raw_json);
        vk := vo.get_Keys;
        FOR i IN 1..vk.COUNT LOOP vb.put(vk(i), vo.get(vk(i))); END LOOP;
        SELF.raw_json := vb.to_Blob;
    END;

    MEMBER FUNCTION pick(p_keys IN SYS.ODCIVARCHAR2LIST) RETURN json_obj IS
        vs  JSON_OBJECT_T;
        vr  JSON_OBJECT_T;
        vk  VARCHAR2(4000);
    BEGIN
        vs := JSON_OBJECT_T.parse(SELF.raw_json); vr := new JSON_OBJECT_T;
        FOR i IN 1..p_keys.COUNT LOOP
            vk := p_keys(i);
            IF vs.has(vk) THEN vr.put(vk, vs.get(vk)); END IF;
        END LOOP;
        RETURN new json_obj(vr.to_Blob);
    END;

    -- omit: index-by table as a skip-set gives O(1) lookup per document key
    -- rather than the O(n*m) nested loop in the original.
    MEMBER FUNCTION omit(p_keys IN SYS.ODCIVARCHAR2LIST) RETURN json_obj IS
        TYPE t_skip_map IS TABLE OF BOOLEAN INDEX BY VARCHAR2(4000);
        skip  t_skip_map;
        vs    JSON_OBJECT_T;
        vr    JSON_OBJECT_T;
        vk    JSON_KEY_LIST;
    BEGIN
        FOR x IN 1..p_keys.COUNT LOOP skip(p_keys(x)) := TRUE; END LOOP;
        vs := JSON_OBJECT_T.parse(SELF.raw_json); vr := new JSON_OBJECT_T;
        vk := vs.get_Keys;
        FOR i IN 1..vk.COUNT LOOP
            IF NOT skip.EXISTS(vk(i)) THEN vr.put(vk(i), vs.get(vk(i))); END IF;
        END LOOP;
        RETURN new json_obj(vr.to_Blob);
    END;

    -- ── SQL json_value ────────────────────────────────────────────────────────

    MEMBER FUNCTION json_value(p_path IN VARCHAR2) RETURN VARCHAR2 IS
        r VARCHAR2(4000);
    BEGIN
        EXECUTE IMMEDIATE
            'SELECT json_value(:1,''' || REPLACE(p_path,'''','''''') || ''') FROM DUAL'
            INTO r USING SELF.raw_json;
        RETURN r;
    END;

    -- ── SQL json_query ────────────────────────────────────────────────────────

    MEMBER FUNCTION json_query(p_path IN VARCHAR2) RETURN VARCHAR2 IS
        r VARCHAR2(4000);
    BEGIN
        EXECUTE IMMEDIATE
            'SELECT json_query(:1,''' || REPLACE(p_path,'''','''''') || ''' WITH WRAPPER) FROM DUAL'
            INTO r USING SELF.raw_json;
        RETURN r;
    END;

    MEMBER FUNCTION json_query_clob(p_path IN VARCHAR2) RETURN CLOB IS
        r CLOB;
    BEGIN
        EXECUTE IMMEDIATE
            'SELECT json_query(:1,''' || REPLACE(p_path,'''','''''') || ''' WITH WRAPPER RETURNING CLOB) FROM DUAL'
            INTO r USING SELF.raw_json;
        RETURN r;
    END;

    -- ── SQL json_exists ───────────────────────────────────────────────────────

    MEMBER FUNCTION json_exists(p_path IN VARCHAR2) RETURN VARCHAR2 IS
        n NUMBER;
    BEGIN
        EXECUTE IMMEDIATE
            'SELECT COUNT(*) FROM DUAL WHERE json_exists(:1,''' || REPLACE(p_path,'''','''''') || ''')'
            INTO n USING SELF.raw_json;
        RETURN CASE n WHEN 1 THEN 'Y' ELSE 'N' END;
    END;

    -- ── SQL json_serialize ────────────────────────────────────────────────────

    MEMBER FUNCTION json_serialize RETURN VARCHAR2 IS
        r VARCHAR2(32767);
    BEGIN SELECT json_serialize(SELF.raw_json) INTO r FROM DUAL; RETURN r; END;

    -- Fixed: original ignored p_pretty and always emitted indented output.
    -- Now branches on UPPER(p_pretty) = 'PRETTY'; any other value is compact.
    MEMBER FUNCTION json_serialize(p_pretty IN VARCHAR2) RETURN VARCHAR2 IS
        r VARCHAR2(32767);
    BEGIN
        IF UPPER(p_pretty) = 'PRETTY' THEN
            SELECT json_serialize(SELF.raw_json PRETTY)  INTO r FROM DUAL;
        ELSE
            SELECT json_serialize(SELF.raw_json)         INTO r FROM DUAL;
        END IF;
        RETURN r;
    END;

    MEMBER FUNCTION json_serialize_clob RETURN CLOB IS
        r CLOB;
    BEGIN SELECT json_serialize(SELF.raw_json RETURNING CLOB) INTO r FROM DUAL; RETURN r; END;

    -- Fixed: same p_pretty bug applied to the CLOB overload.
    MEMBER FUNCTION json_serialize_clob(p_pretty IN VARCHAR2) RETURN CLOB IS
        r CLOB;
    BEGIN
        IF UPPER(p_pretty) = 'PRETTY' THEN
            SELECT json_serialize(SELF.raw_json RETURNING CLOB PRETTY) INTO r FROM DUAL;
        ELSE
            SELECT json_serialize(SELF.raw_json RETURNING CLOB)        INTO r FROM DUAL;
        END IF;
        RETURN r;
    END;

    -- ── SQL json_equal ────────────────────────────────────────────────────────

    MEMBER FUNCTION json_equal(p_other IN json_obj) RETURN VARCHAR2 IS
        r VARCHAR2(1);
    BEGIN
        SELECT CASE WHEN json_equal(SELF.raw_json, p_other.raw_json) THEN 'Y' ELSE 'N' END
          INTO r FROM DUAL;
        RETURN r;
    END;

    -- ── SQL json_mergepatch ───────────────────────────────────────────────────

    MEMBER PROCEDURE json_mergepatch(p_patch IN VARCHAR2) IS
        r BLOB;
    BEGIN
        SELECT json_mergepatch(SELF.raw_json, p_patch RETURNING BLOB) INTO r FROM DUAL;
        SELF.raw_json := r;
    END;

    MEMBER PROCEDURE json_mergepatch(p_patch IN json_obj) IS
        r BLOB;
    BEGIN
        SELECT json_mergepatch(SELF.raw_json, p_patch.raw_json RETURNING BLOB) INTO r FROM DUAL;
        SELF.raw_json := r;
    END;

    -- ── SQL json_object / json_objectagg (static) ─────────────────────────────

    STATIC FUNCTION json_object(p_sql IN VARCHAR2) RETURN json_obj IS
        r BLOB;
    BEGIN
        EXECUTE IMMEDIATE p_sql INTO r;
        RETURN new json_obj(r);
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20002,
                'json_obj.json_object: query must SELECT a single BLOB column. ' ||
                'Ensure JSON_OBJECT(...RETURNING BLOB) is in your SELECT list. ' ||
                'ORA: ' || SQLERRM);
    END;

    STATIC FUNCTION json_objectagg(p_sql IN VARCHAR2) RETURN json_obj IS
        r BLOB;
    BEGIN
        EXECUTE IMMEDIATE p_sql INTO r;
        RETURN new json_obj(r);
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20002,
                'json_obj.json_objectagg: query must SELECT a single BLOB column. ' ||
                'Ensure JSON_OBJECTAGG(...RETURNING BLOB) is in your SELECT list. ' ||
                'ORA: ' || SQLERRM);
    END;

    -- ── SQL json_array / json_arrayagg (static) ───────────────────────────────

    STATIC FUNCTION json_array(p_sql IN VARCHAR2) RETURN JSON_ARRAY_T IS
        r BLOB;
    BEGIN
        EXECUTE IMMEDIATE p_sql INTO r;
        RETURN JSON_ARRAY_T.parse(r);
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20002,
                'json_obj.json_array: query must SELECT a single BLOB column. '  ||
                'Ensure JSON_ARRAY(...RETURNING BLOB) is in your SELECT list. '  ||
                'ORA: ' || SQLERRM);
    END;

    STATIC FUNCTION json_arrayagg(p_sql IN VARCHAR2) RETURN JSON_ARRAY_T IS
        r BLOB;
    BEGIN
        EXECUTE IMMEDIATE p_sql INTO r;
        RETURN JSON_ARRAY_T.parse(r);
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20002,
                'json_obj.json_arrayagg: query must SELECT a single BLOB column. ' ||
                'Ensure JSON_ARRAYAGG(...RETURNING BLOB) is in your SELECT list. ' ||
                'ORA: ' || SQLERRM);
    END;

    -- ── MAP ───────────────────────────────────────────────────────────────────
    -- Serializes the full document for SQL collection ordering and equality.
    -- Two objects with the same keys and values but different insertion order
    -- will compare as unequal.  This is a known limitation of using full
    -- serialization as a map key; there is no clean fix within Oracle SQL type
    -- constraints without a redesign of the type itself.

    MAP MEMBER FUNCTION map_key RETURN VARCHAR2 IS
    BEGIN RETURN JSON_OBJECT_T.parse(SELF.raw_json).to_String; END;

END;
/