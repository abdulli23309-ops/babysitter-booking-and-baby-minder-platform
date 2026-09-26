using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface ICryAlertService
    {
        CryAlertResultDto PostCryAlert(CryAlertDto dto, int currentUserId, string currentRole);
        LatestCryAlertDto GetLatestAlert(int currentUserId, string currentRole, int? parentId);
    }
}
