-- Fix existing scans in the database
-- This script updates old scans to have the correct source and user_id

-- Step 1: Update source field from lowercase 'esp32' to uppercase 'ESP32'
UPDATE barcodes 
SET source = 'ESP32' 
WHERE LOWER(source) = 'esp32';

-- Step 2: Update scans that don't have user_id set
-- This assigns them to user ID 11 (testuser1) - adjust as needed
UPDATE barcodes 
SET user_id = 11 
WHERE user_id IS NULL;

-- Step 3: Verify the changes
SELECT 
    COUNT(*) as total_scans,
    COUNT(CASE WHEN source = 'ESP32' THEN 1 END) as esp32_uppercase_scans,
    COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as scans_with_user_id,
    COUNT(CASE WHEN user_id IS NULL THEN 1 END) as scans_without_user_id
FROM barcodes;
