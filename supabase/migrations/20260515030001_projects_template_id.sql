-- Add template_id FK to projects so we know which template a project was deployed from
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_id INT REFERENCES project_templates(id);
