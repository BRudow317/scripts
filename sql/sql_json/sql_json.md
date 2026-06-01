# Oracle 19c JSON Developer Guide

> A practical reference to Oracle's JSON support -- better examples, less noise.

---
## Links
- [Oracle 19c JSON Developer's Guide](https://docs.oracle.com/en/database/oracle/oracle-database/19/adjsn/loe.html) (the official documentation)

## Table of Contents

1. [Storage and Constraints](#1-storage-and-constraints)
2. [PL/SQL Object Types for JSON](#2-plsql-object-types-for-json)
3. [SQL/JSON Query Functions](#3-sqljson-query-functions)
4. [SQL/JSON Generation Functions](#4-sqljson-generation-functions)
5. [JSON Path Expressions](#5-json-path-expressions)

---

## 1. Storage and Constraints

### Column Types

JSON is stored as ordinary SQL text. Pick a type based on expected document size:

| Type | Max Size | Notes |
|---|---|---|
| `VARCHAR2(32767)` | 32 KB | Best for small documents; enables function-based indexes |
| `CLOB` | 4 GB | Use for large documents; slightly more overhead |
| `BLOB` | 4 GB | Binary storage; Oracle converts charset automatically |

### IS JSON Check Constraint

Always add an `IS JSON` check constraint. It tells the optimizer the column contains JSON, enables dot-notation access, and blocks malformed inserts.

```sql
CREATE TABLE purchase_orders (
    id           VARCHAR2(32)   NOT NULL PRIMARY KEY,
    loaded_at    TIMESTAMP(6)   WITH TIME ZONE,
    doc          VARCHAR2(32767)
    CONSTRAINT po_is_json CHECK (doc IS JSON)
);
```

#### IS JSON Strictness Options

```sql
-- Default: allows duplicate keys (lenient)
doc IS JSON

-- Reject documents that have duplicate field names
doc IS JSON STRICT

-- Allow scalar values (not just objects/arrays) at the top level
doc IS JSON LAX

-- Validate against JSON Schema (19c+)
doc IS JSON VALIDATE USING schema_column
```

#### IS NOT JSON

Useful in queries to find rows with bad data or in a WHERE clause for cleanup:

```sql
-- Find rows that failed to store valid JSON
SELECT id FROM purchase_orders WHERE doc IS NOT JSON;

-- Clean them up
DELETE FROM purchase_orders WHERE doc IS NOT JSON;
```

#### JSON_EQUAL

Compares two JSON values semantically -- ignores whitespace and key ordering:

```sql
-- Returns TRUE even though key order differs
SELECT JSON_EQUAL('{"a":1,"b":2}', '{"b":2,"a":1}') FROM DUAL;
```

---

## 2. PL/SQL Object Types for JSON

These types let you build, traverse, and modify JSON entirely in memory without repeatedly serializing and deserializing text.

### Type Hierarchy

```
JSON_ELEMENT_T          (supertype -- any JSON value)
├── JSON_OBJECT_T       (JSON object  { ... })
├── JSON_ARRAY_T        (JSON array   [ ... ])
└── JSON_SCALAR_T       (string, number, boolean, null)

JSON_KEY_LIST           (VARRAY of VARCHAR2(4000) -- field name list)
```

`JSON_ELEMENT_T` and `JSON_SCALAR_T` cannot be constructed directly; you get them by parsing or by calling a getter.

---

### Constructors

```sql
-- Parse any JSON text → returns the most specific subtype
je := JSON_ELEMENT_T.parse('{"name":"Ada"}');   -- returns JSON_OBJECT_T

-- Parse directly to a known type (raises error if wrong type)
jo := JSON_OBJECT_T.parse('{"name":"Ada"}');
ja := JSON_ARRAY_T.parse('[1, 2, 3]');

-- Build empty objects/arrays
jo := new JSON_OBJECT_T;
ja := new JSON_ARRAY_T;
```

Cast when you have a `JSON_ELEMENT_T` but need the subtype:

```sql
DECLARE
  je JSON_ELEMENT_T;
  jo JSON_OBJECT_T;
BEGIN
  je := JSON_ELEMENT_T.parse('{"city":"Tokyo"}');
  IF je.is_Object THEN
    jo := treat(je AS JSON_OBJECT_T);
    DBMS_OUTPUT.put_line(jo.get_String('city'));   -- Tokyo
  END IF;
END;
```

---

### Introspection Methods (JSON_ELEMENT_T)

All available on any instance -- check before casting to avoid runtime errors.

| Method | Returns | Description |
|---|---|---|
| `is_Object()` | BOOLEAN | True if JSON object |
| `is_Array()` | BOOLEAN | True if JSON array |
| `is_Scalar()` | BOOLEAN | True if scalar value |
| `is_String()` | BOOLEAN | True if JSON string |
| `is_Number()` | BOOLEAN | True if JSON number |
| `is_Boolean()` | BOOLEAN | True if true or false |
| `is_True()` | BOOLEAN | True if exactly `true` |
| `is_False()` | BOOLEAN | True if exactly `false` |
| `is_Null()` | BOOLEAN | True if JSON `null` |
| `is_Date()` | BOOLEAN | True if constructed from SQL DATE |
| `is_Timestamp()` | BOOLEAN | True if constructed from SQL TIMESTAMP |
| `get_Size()` | NUMBER | Members (object), elements (array), or 1 (scalar) |

---

### JSON_OBJECT_T -- Methods

#### Getters

```sql
-- Returns a reference (live pointer) -- changes affect the original
je    := jo.get('fieldName');

-- Returns copies (safe to modify without touching original)
s     := jo.get_String('fieldName');
n     := jo.get_Number('fieldName');
b     := jo.get_Boolean('fieldName');      -- returns BOOLEAN
nested_obj := jo.get_Object('fieldName'); -- returns JSON_OBJECT_T
nested_arr := jo.get_Array('fieldName');  -- returns JSON_ARRAY_T
c     := jo.get_Clob('fieldName');
bl    := jo.get_Blob('fieldName');

-- Get all field names
keys  := jo.get_Keys;                     -- returns JSON_KEY_LIST
```

#### Setters

```sql
jo.put('price', 49.99);         -- add or overwrite a field
jo.put('active', TRUE);
jo.put('tags', json_arr);       -- nest an array
jo.put_Null('discount');        -- explicitly set a field to JSON null
jo.remove('oldField');          -- remove a field
jo.rename_Key('oldName', 'newName');
```

#### Introspection

```sql
BOOLEAN := jo.has('fieldName');           -- does the key exist?
VARCHAR2 := jo.get_Type('fieldName');     -- 'string','number','boolean','null','array','object'
```

---

### JSON_ARRAY_T -- Methods

Arrays are **zero-indexed**.

```sql
-- Append to end
ja.append(42);
ja.append('hello');
ja.append(json_obj);

-- Overwrite element at index (default is INSERT, which shifts)
ja.put(0, 'first', OVERWRITE => TRUE);

-- Read element (returns JSON_ELEMENT_T -- use treat() or a typed getter)
je := ja.get(0);
s  := ja.get_String(0);
n  := ja.get_Number(0);
o  := ja.get_Object(0);
a  := ja.get_Array(0);

-- Size
n  := ja.get_Size;

-- Remove
ja.remove(0);
```

---

### JSON_KEY_LIST

A `VARRAY(32767) OF VARCHAR2(4000)`. Use it to iterate all fields of an object:

```sql
DECLARE
  jo   JSON_OBJECT_T;
  keys JSON_KEY_LIST;
BEGIN
  jo   := JSON_OBJECT_T.parse('{"x":1,"y":2,"z":3}');
  keys := jo.get_Keys;
  FOR i IN 1..keys.COUNT LOOP          -- 1-indexed like all PL/SQL collections
    DBMS_OUTPUT.put_line(keys(i) || ' = ' || jo.get_String(keys(i)));
  END LOOP;
END;
-- x = 1
-- y = 2
-- z = 3
```

---

### Serialization

```sql
-- To VARCHAR2 (up to 32 KB)
v  := jo.to_String;
v  := ja.to_String;

-- To CLOB (two forms)
c  := jo.to_Clob;                      -- creates temporary LOB
jo.to_Clob(existing_clob_variable);   -- writes into existing CLOB (procedure form)

-- To BLOB (UTF-8)
b  := jo.to_Blob;
jo.to_Blob(existing_blob_variable);
```

---

### Cloning

`get()` returns a live reference -- mutating it mutates the original. Use `clone()` when you need an independent copy:

```sql
DECLARE
  original JSON_OBJECT_T;
  copy     JSON_OBJECT_T;
BEGIN
  original := JSON_OBJECT_T.parse('{"count":1}');
  copy     := treat(original.clone() AS JSON_OBJECT_T);
  copy.put('count', 99);
  -- original.get_Number('count') is still 1
  DBMS_OUTPUT.put_line(original.to_String);  -- {"count":1}
  DBMS_OUTPUT.put_line(copy.to_String);      -- {"count":99}
END;
```

---

### Practical Example: Enrich a Document

Calculate line-item totals and write them back into a JSON purchase order:

```sql
CREATE OR REPLACE FUNCTION add_order_totals(po_doc IN VARCHAR2)
  RETURN VARCHAR2
IS
  po        JSON_OBJECT_T;
  items     JSON_ARRAY_T;
  item      JSON_OBJECT_T;
  total_qty NUMBER := 0;
  total_amt NUMBER := 0;
  qty       NUMBER;
  price     NUMBER;
BEGIN
  po    := JSON_OBJECT_T.parse(po_doc);
  items := po.get_Array('LineItems');

  FOR i IN 0 .. items.get_Size - 1 LOOP
    item  := JSON_OBJECT_T(items.get(i));
    qty   := item.get_Number('Quantity');
    price := item.get_Object('Part').get_Number('UnitPrice');
    total_qty := total_qty + qty;
    total_amt := total_amt + (qty * price);
  END LOOP;

  po.put('TotalQuantity', total_qty);
  po.put('TotalAmount',   total_amt);
  RETURN po.to_String;
END;
/

-- Apply to every row
UPDATE purchase_orders
   SET doc = add_order_totals(doc);
```

---

## 3. SQL/JSON Query Functions

These functions run directly in SQL -- no PL/SQL block needed.

---

### Dot Notation

The quickest way to read a single field. Requires an `IS JSON` check constraint on the column.

```sql
-- Basic field access (table alias is required)
SELECT po.doc.PONumber,
       po.doc.Requestor
  FROM purchase_orders po;

-- Nested object
SELECT po.doc.ShippingInstructions.name FROM purchase_orders po;

-- Array element (zero-based)
SELECT po.doc.LineItems[0].Part.Description FROM purchase_orders po;

-- All array elements → returned as a JSON array
SELECT po.doc.LineItems[*].Part.Description FROM purchase_orders po;
```

**Limits:**
- Always returns `VARCHAR2(4000)` -- values over 4 KB come back as NULL
- Field names are case-sensitive after the column name (`po.doc.PONumber` ≠ `po.doc.ponumber`)
- Can't use wildcards like `.*` (not a valid SQL identifier -- use `json_query` instead)

---

### JSON_VALUE

Returns a single scalar value from a JSON document as a SQL type.

```sql
json_value(
  json_expression,
  path_expression
  [RETURNING data_type]
  [ON ERROR   { NULL | ERROR | DEFAULT literal }]
  [ON EMPTY   { NULL | ERROR | DEFAULT literal }]
  [ON MISMATCH { NULL | ERROR | IGNORE }]   -- only for object/collection return types
)
```

**Defaults:** `RETURNING VARCHAR2(4000)`, `NULL ON ERROR`, `NULL ON EMPTY`

```sql
-- Extract a string field
SELECT json_value(doc, '$.Requestor') FROM purchase_orders;

-- Extract a number, typed correctly
SELECT json_value(doc, '$.PONumber' RETURNING NUMBER) FROM purchase_orders;

-- Extract a date
SELECT json_value(doc, '$.OrderDate' RETURNING DATE) FROM purchase_orders;

-- Error on bad data instead of silently returning NULL
SELECT json_value(doc, '$.PONumber' RETURNING NUMBER ERROR ON ERROR)
  FROM purchase_orders;

-- Provide a fallback when the field is missing
SELECT json_value(doc, '$.Priority' DEFAULT 'Normal' ON EMPTY)
  FROM purchase_orders;

-- Extract a boolean (comes back as VARCHAR2 'true'/'false' in SQL)
SELECT json_value(doc, '$.AllowPartialShipment') FROM purchase_orders;

-- Extract a boolean into PL/SQL BOOLEAN (only works in PL/SQL context)
DECLARE b BOOLEAN;
BEGIN
  SELECT json_value(doc, '$.AllowPartialShipment' RETURNING BOOLEAN ERROR ON ERROR)
    INTO b FROM purchase_orders WHERE ROWNUM = 1;
END;
```

**Return type to object/collection type:**

```sql
-- Map a JSON object directly to a PL/SQL object type
CREATE TYPE addr_t AS OBJECT (street VARCHAR2(100), city VARCHAR2(50));
CREATE TYPE shipping_t AS OBJECT (name VARCHAR2(30), address addr_t);

SELECT json_value(doc, '$.ShippingInstructions' RETURNING shipping_t)
  FROM purchase_orders;
```

---

### JSON_QUERY

Returns a JSON fragment (object, array, or multiple values) rather than a scalar. Use this when the result is itself JSON.

```sql
json_query(
  json_expression,
  path_expression
  [RETURNING { VARCHAR2[(size)] | CLOB | BLOB }]
  [WITH [UNCONDITIONAL | CONDITIONAL] [ARRAY] WRAPPER]
  [OMIT QUOTES]
  [ON ERROR   { NULL | ERROR | EMPTY | EMPTY ARRAY | EMPTY OBJECT }]
  [ON EMPTY   { NULL | ERROR | EMPTY | EMPTY ARRAY | EMPTY OBJECT }]
)
```

```sql
-- Return a nested object
SELECT json_query(doc, '$.ShippingInstructions') FROM purchase_orders;
-- {"name":"Alexis Bull","address":{"street":"200 Sporting Green",...},"Phone":[...]}

-- Return an array
SELECT json_query(doc, '$.LineItems') FROM purchase_orders;

-- Collect all phone-type strings into a JSON array
SELECT json_query(doc, '$.ShippingInstructions.Phone[*].type' WITH ARRAY WRAPPER)
  FROM purchase_orders;
-- ["Office","Mobile"]

-- WITH CONDITIONAL WRAPPER: only wraps when multiple values are returned
SELECT json_query(doc, '$.ShippingInstructions.Phone[*].type'
                  WITH CONDITIONAL ARRAY WRAPPER)
  FROM purchase_orders;

-- Use CLOB for large JSON fragments
SELECT json_query(doc, '$.LineItems' RETURNING CLOB)
  FROM purchase_orders;

-- Return empty array instead of NULL when path matches nothing
SELECT json_query(doc, '$.NonExistent' EMPTY ARRAY ON EMPTY)
  FROM purchase_orders;
```

**WITH WRAPPER options:**

| Clause | Behaviour |
|---|---|
| `WITH ARRAY WRAPPER` | Always wraps result in `[ ... ]` |
| `WITH CONDITIONAL ARRAY WRAPPER` | Only wraps if multiple values would be returned |
| `WITHOUT ARRAY WRAPPER` | Never wraps (error if multiple values) -- the default |

---

### JSON_EXISTS

Tests whether a path matches anything in the document. Returns `TRUE` or `FALSE`. Most useful in `WHERE` clauses.

```sql
json_exists(
  json_expression,
  path_expression
  [PASSING value AS "variable_name" [, ...]]
  [ON ERROR { TRUE | FALSE | ERROR }]   -- default: FALSE ON ERROR
)
```

```sql
-- Simple field existence check
SELECT doc FROM purchase_orders
  WHERE json_exists(doc, '$.LineItems');

-- Filter by a nested value
SELECT doc FROM purchase_orders
  WHERE json_exists(doc, '$.LineItems.Part?(@.UPCCode == "85391628927")');

-- Bind a SQL variable into the path -- avoids recompilation on every execution
SELECT doc FROM purchase_orders
  WHERE json_exists(doc, '$.LineItems.Part?(@.UPCCode == $upc)'
                    PASSING :upc_param AS "upc");

-- Compound filter: expensive items with large quantities
SELECT doc FROM purchase_orders
  WHERE json_exists(doc,
          '$.LineItems[*]?(@.Quantity > 10 && @.Part.UnitPrice > 50)');

-- nested exists() predicate -- ensure both conditions are on the SAME line item
SELECT doc FROM purchase_orders
  WHERE json_exists(doc,
          '$?(@.User == "ABULL"
              && exists(@.LineItems[*]?(
                           @.Part.UPCCode == "85391628927"
                           && @.Quantity > 3)))');

-- Raise an error on malformed JSON instead of silently returning FALSE
SELECT doc FROM purchase_orders
  WHERE json_exists(doc, '$.PONumber' ERROR ON ERROR);
```

**Filter scope matters.** When conditions are at the root (`$?(...)`), they scan independently across the whole document. When conditions are at the array level (`$.LineItems[*]?(...)`), both conditions must be true for the **same array element**:

```sql
-- These may match different line items satisfying each condition independently
WHERE json_exists(doc, '$?(@.LineItems.UPCCode == "X" && @.LineItems.Quantity > 5)')

-- This requires one line item to satisfy BOTH conditions
WHERE json_exists(doc, '$.LineItems[*]?(@.UPCCode == "X" && @.Quantity > 5)')
```

---

### JSON_TABLE

Projects JSON into a virtual relational table. One row per array element. The most powerful query function -- and the one the optimizer uses internally when it rewrites multiple `json_value`/`json_query`/`json_exists` calls.

```sql
json_table(
  json_expression,
  row_path_expression
  [ON ERROR { NULL | ERROR }]
  COLUMNS (
    column_definition [, ...]
  )
)
```

#### Column Definition Types

```sql
-- Scalar value (json_value semantics)
col_name  data_type  [PATH 'path']  [ON ERROR ...]  [ON EMPTY ...]

-- JSON fragment (json_query semantics)
col_name  data_type  FORMAT JSON  [WITH WRAPPER]  [PATH 'path']

-- Existence test (json_exists semantics)
col_name  data_type  EXISTS  [PATH 'path']

-- Auto-incrementing row number
col_name  FOR ORDINALITY

-- Nested array expansion (generates a row per nested element)
NESTED [PATH] 'path'  COLUMNS ( ... )
```

If `PATH` is omitted, Oracle uses `'$.<column_name>'` as the default path.

#### Examples

**Flatten a JSON array into rows:**

```sql
SELECT jt.item_no, jt.description, jt.qty, jt.unit_price
  FROM purchase_orders po,
       json_table(po.doc, '$.LineItems[*]'
         COLUMNS (
           item_no     NUMBER        PATH '$.ItemNumber',
           description VARCHAR2(256) PATH '$.Part.Description',
           qty         NUMBER        PATH '$.Quantity',
           unit_price  NUMBER        PATH '$.Part.UnitPrice'
         )) jt;
```

**Mix scalars, JSON fragments, and existence flags:**

```sql
SELECT jt.requestor, jt.phones, jt.has_zip
  FROM purchase_orders,
       json_table(doc, '$'
         COLUMNS (
           requestor  VARCHAR2(128)  PATH '$.Requestor',
           phones     VARCHAR2(500)  FORMAT JSON PATH '$.ShippingInstructions.Phone',
           partial    VARCHAR2(5)    PATH '$.AllowPartialShipment',
           has_zip    VARCHAR2(5)    EXISTS PATH '$.ShippingInstructions.Address.zipCode'
         )) jt
  WHERE jt.partial = 'true'
    AND jt.has_zip = 'true';
```

**FOR ORDINALITY -- add a row counter:**

```sql
SELECT jt.rn, jt.phone_type, jt.phone_num
  FROM purchase_orders po,
       json_table(po.doc, '$.ShippingInstructions.Phone[*]'
         COLUMNS (
           rn          FOR ORDINALITY,
           phone_type  VARCHAR2(20) PATH '$.type',
           phone_num   VARCHAR2(30) PATH '$.number'
         )) jt;
-- RN  PHONE_TYPE  PHONE_NUM
-- 1   Office      909-555-7307
-- 2   Mobile      415-555-1234
```

**NESTED PATH -- expand two levels at once:**

```sql
SELECT jt.po_num, jt.requestor, jt.item_no, jt.description
  FROM purchase_orders po,
       json_table(po.doc, '$'
         COLUMNS (
           po_num      NUMBER        PATH '$.PONumber',
           requestor   VARCHAR2(128) PATH '$.Requestor',
           NESTED PATH '$.LineItems[*]'
             COLUMNS (
               item_no     NUMBER        PATH '$.ItemNumber',
               description VARCHAR2(256) PATH '$.Part.Description',
               qty         NUMBER        PATH '$.Quantity'
             )
         )) jt;
```

**All phones of all matching orders -- collect each phone type into a wrapped array:**

```sql
SELECT jt.po_num, jt.phone_types, jt.phone_numbers
  FROM purchase_orders,
       json_table(doc, '$'
         COLUMNS (
           po_num        NUMBER        PATH '$.PONumber',
           phone_types   VARCHAR2(200) FORMAT JSON WITH WRAPPER
                         PATH '$.ShippingInstructions.Phone[*].type',
           phone_numbers VARCHAR2(200) FORMAT JSON WITH WRAPPER
                         PATH '$.ShippingInstructions.Phone[*].number'
         )) AS jt;
-- PO_NUM  PHONE_TYPES           PHONE_NUMBERS
-- 1600    ["Office","Mobile"]   ["909-555-7307","415-555-1234"]
```

**Create a relational view over JSON storage:**

```sql
CREATE VIEW purchase_order_lines AS
  SELECT jt.*
    FROM purchase_orders po,
         json_table(po.doc, '$'
           COLUMNS (
             po_number    NUMBER(10)         PATH '$.PONumber',
             reference    VARCHAR2(30)       PATH '$.Reference',
             requestor    VARCHAR2(128)      PATH '$.Requestor',
             ship_to_name VARCHAR2(50)       PATH '$.ShippingInstructions.name',
             NESTED PATH '$.LineItems[*]'
               COLUMNS (
                 item_no     NUMBER(10)         PATH '$.ItemNumber',
                 description VARCHAR2(256)      PATH '$.Part.Description',
                 quantity    NUMBER(12,4)       PATH '$.Quantity',
                 unit_price  NUMBER(14,2)       PATH '$.Part.UnitPrice'
               )
           )) jt;
```

**Performance note:** The optimizer automatically merges multiple `json_value`/`json_query`/`json_exists` calls on the same column into a single `json_table` scan. If you write them separately, Oracle still only parses the document once.

---

### JSON_SERIALIZE

Converts any JSON-compatible SQL value back to text. Useful for normalizing or pretty-printing:

```sql
-- Compact output
SELECT json_serialize(doc) FROM purchase_orders WHERE ROWNUM = 1;

-- Pretty-printed
SELECT json_serialize(doc PRETTY) FROM purchase_orders WHERE ROWNUM = 1;

-- Force CLOB return for large documents
SELECT json_serialize(doc RETURNING CLOB PRETTY) FROM purchase_orders;
```

---

## 4. SQL/JSON Generation Functions

Build JSON directly from SQL query results -- no string concatenation needed.

---

### JSON_OBJECT

Constructs a single JSON object.

```sql
json_object(
  key VALUE expr [, key VALUE expr ...]   -- explicit pairs
  | column_name [, ...]                   -- implicit: uses column name as key
  | *                                     -- all columns in SELECT list
  [NULL ON NULL | ABSENT ON NULL]         -- default: NULL ON NULL
  [RETURNING { VARCHAR2[(n)] | CLOB | BLOB }]   -- default: VARCHAR2(4000)
  [STRICT]
  [WITH UNIQUE KEYS]
)
```

```sql
-- Named fields, including nested object
SELECT json_object(
         'id'          VALUE employee_id,
         'name'        VALUE first_name || ' ' || last_name,
         'contact'     VALUE json_object(
                                'email' VALUE email,
                                'phone' VALUE phone_number),
         'hire_date'   VALUE hire_date,
         'salary'      VALUE salary
       )
  FROM hr.employees
  WHERE salary > 15000;
-- {"id":101,"name":"Neena Kochhar","contact":{"email":"NKOCHHAR","phone":"515.123.4568"},...}

-- Omit NULL values rather than including them as JSON null
SELECT json_object(
         'city'     VALUE city,
         'province' VALUE state_province ABSENT ON NULL)
  FROM hr.locations
  WHERE city LIKE 'S%';
-- {"city":"Singapore"}          ← no "province" key at all
-- {"city":"Sydney","province":"New South Wales"}

-- Wildcard -- grabs all columns; column names become uppercase keys
SELECT json_object(*) FROM hr.employees WHERE employee_id = 100;
-- {"EMPLOYEE_ID":100,"FIRST_NAME":"Steven","LAST_NAME":"King",...}

-- Treat a SQL string as a pre-formed JSON value (not a quoted string)
SELECT json_object(
         'name'   VALUE first_name,
         'active' VALUE CASE WHEN end_date IS NULL THEN 'true' ELSE 'false' END
                         FORMAT JSON)
  FROM hr.employees WHERE ROWNUM = 1;
-- {"name":"Steven","active":true}   ← boolean, not the string "true"
```

---

### JSON_ARRAY

Constructs a single JSON array.

```sql
json_array(
  expr [, expr ...]
  [NULL ON NULL | ABSENT ON NULL]   -- default: ABSENT ON NULL
  [RETURNING { VARCHAR2[(n)] | CLOB | BLOB }]
  [STRICT]
)
```

```sql
-- Simple array literal
SELECT json_array(1, 2, 3) FROM DUAL;
-- [1,2,3]

-- Mix column values and literals
SELECT json_array(first_name, last_name, employee_id, hire_date)
  FROM hr.employees WHERE employee_id = 100;
-- ["Steven","King",100,"17-JUN-87"]

-- Nest inside JSON_OBJECT
SELECT json_object(
         'title'       VALUE job_title,
         'salary_range' VALUE json_array(min_salary, max_salary))
  FROM hr.jobs WHERE job_id = 'AD_PRES';
-- {"title":"President","salary_range":[20080,40000]}

-- NULL handling difference
SELECT json_array(1, NULL, 3 NULL ON NULL) FROM DUAL;    -- [1,null,3]
SELECT json_array(1, NULL, 3 ABSENT ON NULL) FROM DUAL;  -- [1,3]
```

---

### JSON_ARRAYAGG

Aggregate function -- collapses multiple rows into one JSON array.

```sql
json_arrayagg(
  expr
  [ORDER BY ...]
  [NULL ON NULL | ABSENT ON NULL]   -- default: ABSENT ON NULL
  [RETURNING { VARCHAR2[(n)] | CLOB | BLOB }]
  [STRICT]
)
```

```sql
-- Collect all department IDs into an array
SELECT json_arrayagg(department_id ORDER BY department_id) FROM hr.departments;
-- [10,20,30,40,50,...]

-- Nest within JSON_OBJECT to build a manager summary
SELECT json_object(
         'manager_id'  VALUE mgr.employee_id,
         'manager'     VALUE mgr.first_name || ' ' || mgr.last_name,
         'report_count' VALUE COUNT(rpt.employee_id),
         'reports'     VALUE json_arrayagg(rpt.employee_id ORDER BY rpt.employee_id)
       )
  FROM hr.employees mgr
  JOIN hr.employees rpt ON rpt.manager_id = mgr.employee_id
  GROUP BY mgr.employee_id, mgr.first_name, mgr.last_name
  HAVING COUNT(rpt.employee_id) > 6;
-- {"manager_id":100,"manager":"Steven King","report_count":14,"reports":[101,102,...]}
```

---

### JSON_OBJECTAGG

Aggregate function -- collapses multiple rows into one JSON object using one column as the key and another as the value.

```sql
json_objectagg(
  key_expr VALUE value_expr
  [NULL ON NULL | ABSENT ON NULL]
  [RETURNING { VARCHAR2[(n)] | CLOB | BLOB }]
  [STRICT]
  [WITH UNIQUE KEYS]
)
```

```sql
-- Map department names to IDs
SELECT json_objectagg(department_name VALUE department_id)
  FROM hr.departments;
-- {"Administration":10,"Marketing":20,...}

-- Map country codes to names, grouped by region
SELECT r.region_name,
       json_objectagg(c.country_id VALUE c.country_name) AS country_map
  FROM hr.regions r
  JOIN hr.countries c ON c.region_id = r.region_id
  GROUP BY r.region_name;
```

---

### SQL-to-JSON Type Mapping

| SQL Type | JSON Rendering |
|---|---|
| `VARCHAR2`, `CHAR`, `NVARCHAR2`, `CLOB` | JSON string (quoted, escaped) |
| `NUMBER`, `BINARY_FLOAT`, `BINARY_DOUBLE` | JSON number (unquoted) |
| `DATE`, `TIMESTAMP` | ISO 8601 string, e.g. `"2024-06-15T00:00:00"` |
| `BOOLEAN` (PL/SQL only) | `true` / `false` (unquoted) |
| `RAW`, `BLOB` | Hexadecimal string |
| `NULL` | `null` or omitted, depending on `NULL ON NULL` / `ABSENT ON NULL` |
| User-defined object type | JSON object |
| Collection type (nested table, varray) | JSON array |
| Infinity | `"Inf"` or `"-Inf"` (string) |
| NaN | `"Nan"` (string) |

---

### Nested JSON -- Full Example

Build a regional hierarchy from three relational tables in one query:

```sql
SELECT json_arrayagg(
         json_object(
           'region'    VALUE r.region_name,
           'countries' VALUE (
             SELECT json_arrayagg(
                      json_object(
                        'code' VALUE c.country_id,
                        'name' VALUE c.country_name,
                        'cities' VALUE (
                          SELECT json_arrayagg(l.city ORDER BY l.city)
                            FROM hr.locations l
                            WHERE l.country_id = c.country_id
                        )
                      )
                    ORDER BY c.country_name)
               FROM hr.countries c
               WHERE c.region_id = r.region_id
           )
         )
       ORDER BY r.region_name
       ) AS result
  FROM hr.regions r;
```

---

## 5. JSON Path Expressions

Path expressions are the query language for navigating JSON. They appear inside `json_value`, `json_query`, `json_exists`, `json_table`, and dot-notation.

---

### Syntax Overview

```
$ [.step | [array_step]] [?(filter)] [.item_method()]
```

| Symbol | Meaning |
|---|---|
| `$` | Root of the JSON document |
| `@` | Current item in a filter expression |
| `.fieldName` | Object step -- access a named field |
| `.*` | Object wildcard -- all field values |
| `[n]` | Array element at index n (zero-based) |
| `[*]` | Array wildcard -- all elements |
| `[m to n]` | Array range (inclusive) |
| `..fieldName` | Descendant step -- recurse to any depth |
| `?(...)` | Filter expression |
| `.method()` | Item method -- transform the selected value |

---

### Object Steps

```sql
-- Single field
$.Requestor
$.ShippingInstructions.name

-- Field with special characters (must be quoted)
$."ship-to"."postal-code"

-- Empty field name
$.""

-- All fields (wildcard)
$.*
$.ShippingInstructions.*
```

---

### Array Steps

```sql
$.LineItems[0]            -- first element (zero-based)
$.LineItems[0].Part       -- field of first element
$.LineItems[*]            -- all elements
$.LineItems[*].Part.UnitPrice   -- one value per element
$.LineItems[0, 2, 4]     -- specific indexes
$.LineItems[0 to 3]       -- range: elements 0, 1, 2, 3
$.Phone[0, 5 to 8, 12]   -- mixed: specific indexes and ranges (must be ascending)
```

---

### Descendant Step (`..`)

Recursively searches all levels of the tree for a named field:

```sql
$..zip                    -- every "zip" field anywhere in the document
$.ShippingInstructions..phone  -- every "phone" within ShippingInstructions

-- Example document:
-- {"a": {"b": {"z": 1}, "c": [5, {"z": 2}], "z": 3}, "z": 4}
-- $.a..z  → [1, 2, 3]   (does NOT include the top-level z:4, which is outside $.a)
```

---

### Syntax Relaxation (Array Wrapping / Unwrapping)

Oracle automatically handles the "single object vs. array of objects" ambiguity:

- If a step expects an array but finds a single object, Oracle wraps it.
- If a step expects an object but finds an array, Oracle iterates the array.

This means `$.LineItems[*].Part` and `$.LineItems.Part` are equivalent -- both work whether `LineItems` is a single object or an array.

```sql
-- These three are identical in practice
$.friends[*].name
$.friends.name
$.friends[*].name
```

---

### Filter Expressions

Filters narrow down which elements a step returns. They live inside `?(...)` and use `@` to refer to the current item.

#### Comparison Operators

```sql
?(@.price == 19.99)
?(@.status != "cancelled")
?(@.quantity > 0)
?(@.score >= 90)
?(@.priority < 3)
?(@.score <= 100)
```

#### Boolean Logic

```sql
-- AND
?(@.qty > 1 && @.price < 50)

-- OR
?(@.status == "pending" || @.status == "open")

-- NOT
?(!(@.discontinued))

-- Precedence: ! > && > ||
-- Use parentheses to be explicit
?( !(@.closed) && (@.qty > 1 || @.priority == "high") )
```

#### Existence Check

```sql
-- True if the field exists (regardless of value)
?( exists(@.discountCode) )

-- True if the nested path exists
?( exists(@.address.city) )
```

#### String Matching

```sql
?(@.city has substring "San")          -- contains the substring
?(@.name starts with "Jo")             -- prefix match
?(@.code like "A_[0-9]%")             -- SQL LIKE pattern (% and _)
?(@.id like_regex "[0-9]{4}-[A-Z]{2}")-- regex match anywhere in string
?(@.id eq_regex "[0-9]{4}-[A-Z]{2}")  -- regex must match entire string
```

#### Value List Membership

```sql
?(@.status in ("pending", "approved", "in_progress"))
```

#### PASSING Clause (Bind Variables in Paths)

Bind SQL values into path expressions. Oracle compiles the path once and substitutes the value at runtime -- avoids reparsing on every row and protects against injection:

```sql
SELECT doc FROM purchase_orders
  WHERE json_exists(doc,
          '$.LineItems.Part?(@.UPCCode == $upc AND @.UnitPrice < $max_price)'
          PASSING :upc_param AS "upc",
                  :price_limit AS "max_price");
```

Supported PASSING types: `VARCHAR2`, `NUMBER`, `BINARY_DOUBLE`, `DATE`, `TIMESTAMP`, `TIMESTAMP WITH TIME ZONE`.

---

### Filter Scope -- Common Gotcha

In a conjunction (`&&`), each condition is evaluated against the **same level** independently unless you use downscoping:

```sql
-- These may be satisfied by DIFFERENT line items:
$.LineItems?(@.UPCCode == "X" && @.Quantity > 5)

-- This requires ONE line item to satisfy BOTH:
$.LineItems[*]?(@.UPCCode == "X" && @.Quantity > 5)
```

Always use `[*]` before the filter when you need all conditions to be true for the same array element.

---

### Item Methods

Applied at the end of a path to transform or filter the selected value. Except for `type()` and `size()`, methods iterate over array elements rather than treating the array as a unit.

#### Type Conversion

| Method | Returns | Notes |
|---|---|---|
| `string()` | `VARCHAR2(4000)` | Converts any JSON scalar to string; JSON null → SQL NULL |
| `number()` | `NUMBER` | Converts string "42" → number 42 |
| `boolean()` | `VARCHAR2(20)` | Returns `'true'` or `'false'` |
| `date()` | `DATE` | Requires ISO 8601 format |
| `timestamp()` | `TIMESTAMP` | Requires ISO 8601 format |
| `double()` | `BINARY_DOUBLE` | Converts number or numeric string |

#### Filtering Methods (keep only matching types)

| Method | Keeps |
|---|---|
| `stringOnly()` | Only JSON strings |
| `numberOnly()` | Only JSON numbers |
| `booleanOnly()` | Only JSON booleans |

```sql
-- Extract only string values from a mixed array
SELECT json_query('["alpha", 42, "10.4", true]', '$[*].stringOnly()'
                  WITH ARRAY WRAPPER)
  FROM DUAL;
-- ["alpha","10.4"]

-- Only numeric items
SELECT json_query('[1, "two", 3, null, 5]', '$[*].numberOnly()'
                  WITH ARRAY WRAPPER)
  FROM DUAL;
-- [1,3,5]
```

#### Math Methods

```sql
$.price.abs()        -- absolute value
$.score.ceiling()    -- round up
$.score.floor()      -- round down
```

#### String Methods

```sql
$.name.length()      -- character count → NUMBER
$.code.lower()       -- lowercase
$.code.upper()       -- uppercase
```

#### Type and Size

```sql
$.type()             -- "null","boolean","number","string","array","object"
$.size()             -- number of elements (array), number of fields (object), 1 (scalar)

-- type() and size() treat arrays as a unit:
SELECT json_value('[1,"two",true]', '$.type()') FROM DUAL;   -- "array"
SELECT json_value('[1,"two",true]', '$.size()') FROM DUAL;   -- 3

-- To get the type of each element, iterate:
SELECT json_query('[1,"two",true]', '$[*].type()' WITH ARRAY WRAPPER) FROM DUAL;
-- ["number","string","boolean"]
```

---

### ISO 8601 Date/Time Formats

Required when using `date()` and `timestamp()` item methods.

| Format | Example |
|---|---|
| Date only | `2024-06-15` |
| Date + time | `2024-06-15T14:30:00` |
| With timezone offset | `2024-06-15T14:30:00+05:30` |
| UTC (`Z`) | `2024-06-15T09:00:00Z` |
| With fractional seconds | `2024-06-15T14:30:00.123456` |

```sql
-- Filter orders placed after 2024-01-01
SELECT doc FROM purchase_orders
  WHERE json_exists(doc, '$.OrderDate?(@.date() > "2024-01-01")');

-- Extract as SQL DATE
SELECT json_value(doc, '$.OrderDate' RETURNING DATE) FROM purchase_orders;
```

---

### Type Comparison Rules

Oracle checks types at compile time to stay consistent across query plans, indexes, and materialized views.

When a filter compares a path result to a literal, Oracle looks at the literal's type and may cast the path result:

```sql
-- Oracle casts the path result to NUMBER (because the literal is numeric)
$.items?(@.price == 19.99)
-- equivalent to:
$.items?(@.price.number() == 19.99)

-- Prevent the cast -- only actual JSON numbers will match
$.items?(@.price.numberOnly() == 19.99)
```

**Safe automatic reconciliations:**

| Path result type | Literal type | Oracle does |
|---|---|---|
| `string` | `number` | applies `number()` to string |
| `number` | `double` | applies `double()` to number |
| `string` | `boolean` | applies `boolean()` to string |
| `string` | `date` | applies `date()` to ISO 8601 string |
| `string` | `timestamp` | applies `timestamp()` to ISO 8601 string |

Anything else (e.g. comparing a number path to a string literal) is a compile-time error.

---

### Complete Path Examples

```sql
-- All phone numbers under ShippingInstructions
$.ShippingInstructions.Phone[*].number

-- All "zip" fields anywhere in the document
$..zip

-- Line items where quantity > 5 and unit price < 20
$.LineItems[*]?(@.Quantity > 5 && @.Part.UnitPrice < 20)

-- All products where the description starts with "Oracle"
$.products[*]?(@.description starts with "Oracle")

-- Items in a specific set of statuses
$.orders[*]?(@.status in ("pending","processing","shipped"))

-- Items from 2020 or later (using date item method)
$.events[*]?(@.date.date() >= "2020-01-01")

-- Get the type of each value in a mixed array
$[*].type()

-- Extract string names only from a mixed array
$[*].name.stringOnly()

-- Nested existence: orders placed by "ABULL" containing a specific UPC
$?(@.User == "ABULL" && exists(@.LineItems[*]?(@.Part.UPCCode == "85391628927")))
```

---

### Quick Reference: Which Function to Use

| Goal | Function |
|---|---|
| Read one scalar value from JSON | `json_value` or dot notation |
| Read a JSON object or array fragment | `json_query` |
| Test whether a path exists | `json_exists` |
| Turn JSON arrays into rows | `json_table` |
| Build a JSON object from SQL columns | `json_object` |
| Build a JSON array from SQL values | `json_array` |
| Aggregate rows into a JSON array | `json_arrayagg` |
| Aggregate rows into a JSON object | `json_objectagg` |
| Normalize / pretty-print stored JSON | `json_serialize` |
| Build and mutate JSON in PL/SQL | `JSON_OBJECT_T`, `JSON_ARRAY_T` |
