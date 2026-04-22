-- Create tables for Data Factory datasets
-- Skipping the first 'Index' column from CSVs

CREATE TABLE df_customers (
    customer_id         VARCHAR2(255) PRIMARY KEY,
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
);

CREATE TABLE df_leads (
    account_id          VARCHAR2(255) PRIMARY KEY,
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
);

CREATE TABLE df_organizations (
    organization_id     VARCHAR2(255) PRIMARY KEY,
    name                VARCHAR2(255),
    website             VARCHAR2(255),
    country             VARCHAR2(255),
    description         VARCHAR2(4000),
    founded             NUMBER(4),
    industry            VARCHAR2(255),
    num_employees       NUMBER
);

CREATE TABLE df_products (
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
    internal_id         NUMBER PRIMARY KEY
);
