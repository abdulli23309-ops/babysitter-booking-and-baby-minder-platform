using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IAccountService
    {
        void DeactivateParent(int parentId);
        void DeactivateSitter(int sitterId);
        SitterEarningsDto GetSitterEarnings(int sitterId);
        void UpdateSitter(int sitterId, UpdateSitterDto dto);
    }
}
