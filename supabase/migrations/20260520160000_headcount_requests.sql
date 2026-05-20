-- Add missing columns to recruitment_jobs
ALTER TABLE recruitment_jobs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS headcount int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS headcount_request_id int,
  ADD COLUMN IF NOT EXISTS created_by int REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Headcount requests (人力需求單)
CREATE TABLE IF NOT EXISTS headcount_requests (
  id serial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id),
  dept text NOT NULL,
  position_title text NOT NULL,
  headcount int NOT NULL DEFAULT 1,
  expected_start_date date,
  reason text,
  status text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_by int REFERENCES employees(id),
  reviewed_by int REFERENCES employees(id),
  reviewed_at timestamptz,
  job_id int REFERENCES recruitment_jobs(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE headcount_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "headcount_requests_org" ON headcount_requests
  USING (organization_id = (
    SELECT organization_id FROM employees WHERE id = (auth.uid())::int
  ));
