SET NOCOUNT ON;
SELECT t.Slot_ID, t.StartTime, t.EndTime,
       sa.Slot_ID AS Available_Slot_ID,
       j.Job_ID AS Booked_Job_ID,
       j.Status AS Booked_Job_Status,
       j.AssignedSitter_ID
FROM TimeSlot t
LEFT JOIN SitterAvailability sa ON sa.Slot_ID = t.Slot_ID AND sa.Sitter_ID = 19
LEFT JOIN Job j ON j.JobDate = CAST(t.StartTime AS DATE) AND j.AssignedSitter_ID = 19 AND j.IsDeleted = 0
WHERE t.StartTime >= '2026-10-13 00:00:00' AND t.EndTime <= '2026-10-23 23:59:59'
ORDER BY t.StartTime;
