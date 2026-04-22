LOAD DATA
INFILE 'Q:\library\DemoData\data factory\organizations-10000.csv'
APPEND
INTO TABLE df_organizations
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
TRAILING NULLCOLS
(
  idx_filler FILLER,
  organization_id,
  name,
  website,
  country,
  description CHAR(4000),
  founded,
  industry,
  num_employees
)
