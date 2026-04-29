-- Set LINE channel_id = '2009567492' for all rows in line_channels.
-- This is the Messaging API channel ID matching the LIFF prefix used throughout the app.
UPDATE line_channels
SET channel_id = '2009567492',
    updated_at = now()
WHERE channel_id IS DISTINCT FROM '2009567492';
