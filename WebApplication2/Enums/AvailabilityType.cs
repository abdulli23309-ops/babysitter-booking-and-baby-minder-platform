namespace WebApplication2.Enums
{
    /// <summary>
    /// Types of babysitter availability supported by the system.
    /// JSON contract values match these enum member names exactly.
    /// </summary>
    public enum AvailabilityType
    {
        /// <summary>One-day (date-specific) availability. JSON value: "OneDay".</summary>
        OneDay,

        /// <summary>Recurring weekly availability. JSON value: "Recurring".</summary>
        Recurring
    }
}