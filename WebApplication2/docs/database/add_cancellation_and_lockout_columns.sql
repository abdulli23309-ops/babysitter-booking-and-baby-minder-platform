IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='CancellationReason' AND Object_ID=OBJECT_ID('Job'))
  ALTER TABLE Job ADD CancellationReason NVARCHAR(200) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='CancelledAt' AND Object_ID=OBJECT_ID('Job'))
  ALTER TABLE Job ADD CancelledAt DATETIME NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='SitterLockedUntil' AND Object_ID=OBJECT_ID('Babysitter'))
  ALTER TABLE Babysitter ADD SitterLockedUntil DATETIME NULL;
GO
