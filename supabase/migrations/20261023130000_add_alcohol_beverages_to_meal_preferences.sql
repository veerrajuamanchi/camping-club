-- Migration: 20261023130000_add_alcohol_beverages_to_meal_preferences.sql
-- Description: Adds alcohol_beverages column to trip_meal_preferences for multi-select alcohol and evening beverage preferences

ALTER TABLE public.trip_meal_preferences
ADD COLUMN IF NOT EXISTS alcohol_beverages TEXT[] NOT NULL DEFAULT '{}';
