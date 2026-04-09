-- Employee salary fields by employment type
ALTER TABLE employees ADD COLUMN IF NOT EXISTS base_salary INT DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_type TEXT DEFAULT 'monthly'; -- monthly, hourly
ALTER TABLE employees ADD COLUMN IF NOT EXISTS meal_allowance INT DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS transport_allowance INT DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS housing_allowance INT DEFAULT 0;
