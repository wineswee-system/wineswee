-- Set 'workflow' (channel_id 2009191289) as the default LINE channel.
-- All push notifications now use LINE_CHANNEL_ACCESS_TOKEN_WORKFLOW.
UPDATE line_channels SET is_default = false WHERE is_default = true;
UPDATE line_channels SET is_default = true  WHERE code = 'workflow';
