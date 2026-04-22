-- Script to define External Tables for Data Factory datasets
-- Requires directory access in Oracle

-- 1. Create directory object (Update the path as per DB server accessibility)
-- CREATE OR REPLACE DIRECTORY DATA_FACTORY_DIR AS 'Q:\library\DemoData\data factory';

-- 2. External Table for Customers
CREATE TABLE ext_df_customers (
    csv_index           NUMBER,
    customer_id         VARCHAR2(255),
    first_name          VARCHAR2(255),
    last_name           VARCHAR2(255),
    company             VARCHAR2(255),
    city                VARCHAR2(255),
    country             VARCHAR2(255),
    phone_1             VARCHAR2(50),
    phone_2             VARCHAR2(50),
    email               VARCHAR2(255),
    subscription_date   DATE,
    website             VARCHAR2(255)
)
ORGANIZATION EXTERNAL (
  TYPE ORACLE_LOADER
  DEFAULT DIRECTORY DATA_FACTORY_DIR
  ACCESS PARAMETERS (
    RECORDS DELIMITED BY NEWLINE
    SKIP 1
    FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' 
    MISSING FIELD VALUES ARE NULL
    (
      csv_index           CHAR(255),
      customer_id         CHAR(255),
      first_name          CHAR(255),
      last_name           CHAR(255),
      company             CHAR(255),
      city                CHAR(255),
      country             CHAR(255),
      phone_1             CHAR(255),
      phone_2             CHAR(255),
      email               CHAR(255),
      subscription_date   CHAR(10) DATE_FORMAT DATE MASK "YYYY-MM-DD",
      website             CHAR(255)
    )
  )
  LOCATION ('customers-100000.csv')
) REJECT LIMIT UNLIMITED;

-- 3. External Table for Leads
CREATE TABLE ext_df_leads (
    csv_index           NUMBER,
    account_id          VARCHAR2(255),
    lead_owner          VARCHAR2(255),
    first_name          VARCHAR2(255),
    last_name           VARCHAR2(255),
    company             VARCHAR2(255),
    phone_1             VARCHAR2(50),
    phone_2             VARCHAR2(50),
    email_1             VARCHAR2(255),
    email_2             VARCHAR2(255),
    website             VARCHAR2(255),
    source              VARCHAR2(255),
    deal_stage          VARCHAR2(255),
    notes               VARCHAR2(4000)
)
ORGANIZATION EXTERNAL (
  TYPE ORACLE_LOADER
  DEFAULT DIRECTORY DATA_FACTORY_DIR
  ACCESS PARAMETERS (
    RECORDS DELIMITED BY NEWLINE
    SKIP 1
    FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' 
    MISSING FIELD VALUES ARE NULL
    (
      csv_index           CHAR(255),
      account_id          CHAR(255),
      lead_owner          CHAR(255),
      first_name          CHAR(255),
      last_name           CHAR(255),
      company             CHAR(255),
      phone_1             CHAR(255),
      phone_2             CHAR(255),
      email_1             CHAR(255),
      email_2             CHAR(255),
      website             CHAR(255),
      source              CHAR(255),
      deal_stage          CHAR(255),
      notes               CHAR(4000)
    )
  )
  LOCATION ('leads-1000.csv')
) REJECT LIMIT UNLIMITED;

-- 4. External Table for Organizations
CREATE TABLE ext_df_organizations (
    csv_index           NUMBER,
    organization_id     VARCHAR2(255),
    name                VARCHAR2(255),
    website             VARCHAR2(255),
    country             VARCHAR2(255),
    description         VARCHAR2(4000),
    founded             NUMBER(4),
    industry            VARCHAR2(255),
    num_employees       NUMBER
)
ORGANIZATION EXTERNAL (
  TYPE ORACLE_LOADER
  DEFAULT DIRECTORY DATA_FACTORY_DIR
  ACCESS PARAMETERS (
    RECORDS DELIMITED BY NEWLINE
    SKIP 1
    FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' 
    MISSING FIELD VALUES ARE NULL
    (
      csv_index           CHAR(255),
      organization_id     CHAR(255),
      name                CHAR(255),
      website             CHAR(255),
      country             CHAR(255),
      description         CHAR(4000),
      founded             CHAR(255),
      industry            CHAR(255),
      num_employees       CHAR(255)
    )
  )
  LOCATION ('organizations-10000.csv')
) REJECT LIMIT UNLIMITED;

-- 5. External Table for Products
CREATE TABLE ext_df_products (
    csv_index           NUMBER,
    name                VARCHAR2(255),
    description         VARCHAR2(4000),
    brand               VARCHAR2(255),
    category            VARCHAR2(255),
    price               NUMBER(15, 2),
    currency            VARCHAR2(10),
    stock               NUMBER,
    ean                 VARCHAR2(20),
    color               VARCHAR2(50),
    size                VARCHAR2(50),
    availability        VARCHAR2(50),
    internal_id         NUMBER
)
ORGANIZATION EXTERNAL (
  TYPE ORACLE_LOADER
  DEFAULT DIRECTORY DATA_FACTORY_DIR
  ACCESS PARAMETERS (
    RECORDS DELIMITED BY NEWLINE
    SKIP 1
    FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' 
    MISSING FIELD VALUES ARE NULL
    (
      csv_index           CHAR(255),
      name                CHAR(255),
      description         CHAR(4000),
      brand               CHAR(255),
      category            CHAR(255),
      price               CHAR(255),
      currency            CHAR(255),
      stock               CHAR(255),
      ean                 CHAR(255),
      color               CHAR(255),
      size                CHAR(255),
      availability        CHAR(255),
      internal_id         CHAR(255)
    )
  )
  LOCATION ('products-1000.csv')
) REJECT LIMIT UNLIMITED;
