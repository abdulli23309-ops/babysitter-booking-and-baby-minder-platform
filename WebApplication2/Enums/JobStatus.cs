namespace WebApplication2.Enums
{
    /// <summary>
    /// Represents the lifecycle status of a Job.
    /// String values must match what the frontend expects.
    /// </summary>
    public enum JobStatus
    {
        Open,
        Assigned,
        SitterArrived,
        InProgress,
        Completed,
        Cancelled
    }
}
