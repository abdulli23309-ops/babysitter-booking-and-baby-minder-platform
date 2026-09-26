using System.Web;
using WebApplication2.DTOs;

namespace WebApplication2.Services.Interfaces
{
    public interface IImageService
    {
        ImageFileResult ResolveImage(string type, string filename);
        string UploadProfilePicture(HttpPostedFileBase file, string role);
        string UploadProfilePicture(HttpPostedFile file, string role);
    }
}
