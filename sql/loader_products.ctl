LOAD DATA
INFILE 'Q:\library\DemoData\data factory\products-1000.csv'
APPEND
INTO TABLE df_products
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
TRAILING NULLCOLS
(
  idx_filler FILLER,
  name,
  description CHAR(4000),
  brand,
  category,
  price,
  currency,
  stock,
  ean,
  color,
  size,
  availability,
  internal_id
)
