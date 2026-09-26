-- Add JobInvitation table for the parallel-invite / parent-hire flow.
-- Additive only. No existing table is altered.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobInvitation')
BEGIN
    CREATE TABLE JobInvitation (
        JobInvitation_ID  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Job_ID            INT                NOT NULL,
        Sitter_ID         INT                NOT NULL,
        Status            NVARCHAR(20)       NOT NULL DEFAULT 'Invited',
        InvitedAt         DATETIME           NOT NULL DEFAULT GETUTCDATE(),
        RespondedAt       DATETIME           NULL,

        CONSTRAINT FK_JobInvitation_Job
            FOREIGN KEY (Job_ID) REFERENCES Job(Job_ID),

        CONSTRAINT FK_JobInvitation_Sitter
            FOREIGN KEY (Sitter_ID) REFERENCES Babysitter(Sitter_ID),

        CONSTRAINT UQ_JobInvitation_Job_Sitter
            UNIQUE (Job_ID, Sitter_ID)
    );

    CREATE INDEX IX_JobInvitation_Sitter_Status
        ON JobInvitation(Sitter_ID, Status);

    CREATE INDEX IX_JobInvitation_Job_Status
        ON JobInvitation(Job_ID, Status);
END
GO