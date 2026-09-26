using System.Collections.Generic;
using System.Web;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IChildService
    {
        IEnumerable<ChildDto> GetChildrenByParent(int parentId);
        ChildOperationResult CreateChild(HttpRequest request);
        ChildOperationResult CreateChild(CreateChildDto dto, HttpPostedFile postedFile, bool useDefaultPicture);
        ChildOperationResult UpdateChild(int childId, HttpRequest request, int currentUserId);
        ChildOperationResult UpdateChild(int childId, UpdateChildDto dto, HttpPostedFile postedFile, bool useDefaultPicture, int currentUserId);
        void DeleteChild(int childId, int currentUserId);
    }
}
