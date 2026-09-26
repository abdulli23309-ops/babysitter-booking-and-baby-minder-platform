using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IAvailabilityService
    {
        void SaveAvailability(AvailabilityDto dto);
        SitterAvailabilityResponseDto GetSitterAvailability(int sitterId);
        int ClearAllAvailability(int sitterId);

        Dictionary<int, SitterAvailabilityCoordsDto> GetAvailabilityLocations(IEnumerable<int> availabilityIds);
    }
}
