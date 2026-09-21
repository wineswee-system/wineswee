-- Rename the workflow LINE channel to its actual brand name.
UPDATE line_channels
SET name = 'Wineswe 員工機器人'
WHERE code = 'workflow';
