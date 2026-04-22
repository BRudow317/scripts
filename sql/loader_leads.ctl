LOAD DATA
INFILE 'Q:\library\DemoData\data factory\leads-1000.csv'
APPEND
INTO TABLE df_leads
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
TRAILING NULLCOLS
(
  idx_filler FILLER,
  account_id,
  lead_owner,
  first_name,
  last_name,
  company,
  phone_1,
  phone_2,
  email_1,
  email_2,
  website,
  source,
  deal_stage,
  notes CHAR(4000)
)
