using System.Collections.Generic;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IJobInvitationService
    {
        InvitationOperationResult Invite(int jobId, InviteSittersDto dto);
        List<JobInvitationItemDto> GetInvitationsForJob(int jobId, int currentParentId);
        List<SitterInvitationItemDto> GetInvitationsForSitter(int sitterId);
        InvitationOperationResult Accept(int invitationId, int currentSitterId);
        InvitationOperationResult Decline(int invitationId, int currentSitterId);
        InvitationOperationResult DeclineByJob(int jobId, int currentSitterId);
        InvitationOperationResult Hire(int jobId, HireSitterDto dto);
    }
}