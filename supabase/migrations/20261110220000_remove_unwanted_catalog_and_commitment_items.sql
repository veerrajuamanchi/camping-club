-- Migration: Remove unwanted master food, master gear, and trip commitment items
-- Requested items:
-- 1. Artisan Bread & Bagels
-- 2. Ground Coffee & Tea Variety
-- 3. Purified Drinking Water
-- 4. Campfire S'mores Kit
-- 5. Firewood & Kindling
-- 6. High-Capacity Coolers with Ice
-- 7. Pancake Mix & Maple Syrup
-- 8. Camp Potatoes & Onions

-- Step 1: Remove existing commitments for these items from all trips
DELETE FROM public.trip_commitments
WHERE item_name IN (
    'Artisan Bread & Bagels',
    'Ground Coffee & Tea Variety',
    'Purified Drinking Water',
    'Campfire S''mores Kit',
    'Firewood & Kindling',
    'High-Capacity Coolers with Ice',
    'Pancake Mix & Maple Syrup',
    'Camp Potatoes & Onions'
);

-- Step 2: Remove from master_food_groceries catalog
DELETE FROM public.master_food_groceries
WHERE name IN (
    'Artisan Bread & Bagels',
    'Ground Coffee & Tea Variety',
    'Purified Drinking Water',
    'Campfire S''mores Kit',
    'Firewood & Kindling',
    'Pancake Mix & Maple Syrup',
    'Camp Potatoes & Onions'
);

-- Step 3: Remove from master_gear catalog
DELETE FROM public.master_gear
WHERE name IN (
    'High-Capacity Coolers with Ice'
);
