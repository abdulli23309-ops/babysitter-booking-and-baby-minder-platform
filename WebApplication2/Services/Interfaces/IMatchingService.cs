using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IMatchingService
    {
        IEnumerable<MatchingSitterResultDto> GetMatchingSitters(int jobId, int currentUserId);
        List<SitterDTO> FilterSitters(FilterSittersDTO filter);
        List<SitterDTO> SearchSitters(SearchSittersDTO dto);
        List<MatchingJobDto> GetJobRequestsForSitter(int sitterId);
        SitterDTO GetBabysitterDetails(int id);
    }
}
