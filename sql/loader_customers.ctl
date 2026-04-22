LOAD DATA
INFILE 'Q:\library\DemoData\data factory\customers-100000.csv'
APPEND
INTO TABLE df_customers
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
TRAILING NULLCOLS
(
  idx_filler FILLER,
  customer_id,
  first_name,
  last_name,
  company,
  city,
  country,
  phone_1,
  phone_2,
  email,
  subscription_date DATE "YYYY-MM-DD",
  website
)
