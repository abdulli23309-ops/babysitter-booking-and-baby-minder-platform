-- ===================================================================
-- add_geo_columns.sql
-- Adds nullable geo-coordinate columns to support geo-matching.
-- Idempotent: safe to run multiple times on the same database.
-- Only ADDS columns. Does NOT drop, rename, or alter any existing column.
-- Schema managed outside the EDMX (accessed via raw SQL in the service layer).
-- ===================================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='Latitude'  AND Object_ID=OBJECT_ID('SitterAvailability'))
    ALTER TABLE SitterAvailability ADD Latitude FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='Longitude' AND Object_ID=OBJECT_ID('SitterAvailability'))
    ALTER TABLE SitterAvailability ADD Longitude FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='RadiusKm'  AND Object_ID=OBJECT_ID('SitterAvailability'))
    ALTER TABLE SitterAvailability ADD RadiusKm FLOAT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='Latitude'  AND Object_ID=OBJECT_ID('Job'))
    ALTER TABLE Job ADD Latitude FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='Longitude' AND Object_ID=OBJECT_ID('Job'))
    ALTER TABLE Job ADD Longitude FLOAT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='Latitude'  AND Object_ID=OBJECT_ID('Parent'))
    ALTER TABLE Parent ADD Latitude FLOAT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='Longitude' AND Object_ID=OBJECT_ID('Parent'))
    ALTER TABLE Parent ADD Longitude FLOAT NULL;
GO