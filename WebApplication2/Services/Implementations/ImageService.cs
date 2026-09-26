using System;
using System.IO;
using System.Web;
using System.Web.Hosting;
using WebApplication2.DTOs;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    public class ImageService : IImageService
    {
        private readonly Func<string, string> _mapPath;

        public ImageService() : this(DefaultMapPath)
        {
        }

        public ImageService(Func<string, string> mapPath)
        {
            _mapPath = mapPath ?? DefaultMapPath;
        }

        private static string DefaultMapPath(string virtualPath)
        {
            if (HttpContext.Current != null && HttpContext.Current.Server != null)
            {
                return HttpContext.Current.Server.MapPath(virtualPath);
            }
            return HostingEnvironment.MapPath(virtualPath) ?? virtualPath;
        }

        public ImageFileResult ResolveImage(string type, string filename)
        {
            // B5 hardening: reject path traversal in type and filename segments.
            if (string.IsNullOrWhiteSpace(filename) ||
                filename.Contains("..") ||
                filename.Contains("/") ||
                filename.Contains("\\") ||
                (!string.IsNullOrWhiteSpace(type) && (type.Contains("..") || type.Contains("/") || type.Contains("\\"))))
            {
                return new ImageFileResult { IsValid = false };
            }

            // Determine folder based on type using a normal switch
            string folder;
            string defaultFallback;
            switch (type?.Trim().ToLowerInvariant())
            {
                case "parents":
                    folder = "~/Images/Parents/";
                    defaultFallback = "~/Images/Parents/default_parent.jpg";
                    break;
                case "sitters":
                    folder = "~/Images/Sitters/";
                    defaultFallback = "~/Images/Sitters/default_sitter.jpg";
                    break;
                case "children":
                case "childrens":
                    folder = "~/Images/Children/";
                    defaultFallback = "~/Images/Children/default_child.jpg";
                    break;
                default:
                    folder = "~/Images/";
                    defaultFallback = "~/Images/default.jpg";
                    break;
            }

            string path = _mapPath(folder + filename);

            // If the requested image does not exist, fallback to folder default, then root default
            if (!File.Exists(path))
            {
                path = _mapPath(defaultFallback);
                if (!File.Exists(path))
                {
                    path = _mapPath("~/Images/default.jpg");
                    if (!File.Exists(path))
                    {
                        return new ImageFileResult { IsValid = true, Exists = false };
                    }
                }
            }

            string ext = Path.GetExtension(path)?.ToLowerInvariant();
            string mimeType = "image/jpeg";
            if (ext == ".png") mimeType = "image/png";
            else if (ext == ".gif") mimeType = "image/gif";
            else if (ext == ".webp") mimeType = "image/webp";
            else if (ext == ".svg") mimeType = "image/svg+xml";

            return new ImageFileResult
            {
                IsValid = true,
                Exists = true,
                FilePath = path,
                MimeType = mimeType
            };
        }

        public string UploadProfilePicture(HttpPostedFile file, string role)
        {
            if (file == null)
                throw new ArgumentException("No file provided.");
            return UploadProfilePicture(new HttpPostedFileWrapper(file), role);
        }

        public string UploadProfilePicture(HttpPostedFileBase file, string role)
        {
            if (file == null || file.ContentLength == 0)
                throw new ArgumentException("No file provided.");
            if (file.ContentLength > 5 * 1024 * 1024)
                throw new ArgumentException("File too large (max 5 MB).");

            var ext = Path.GetExtension(file.FileName)?.ToLowerInvariant();
            if (ext != ".jpg" && ext != ".jpeg" && ext != ".png")
                throw new ArgumentException("Only .jpg, .jpeg, .png allowed.");

            // Role claim values are the UserRole enum names ("Parent" / "Sitter") — see SessionAuthorizeAttribute.
            var isParent = string.Equals(role, "Parent", StringComparison.OrdinalIgnoreCase);
            var isSitter = string.Equals(role, "Sitter", StringComparison.OrdinalIgnoreCase);
            if (!isParent && !isSitter)
                throw new ArgumentException("Unrecognized role for profile picture upload.");

            var subfolder = isParent ? "Parents" : "Sitters";
            var fileName = Guid.NewGuid().ToString() + ext;
            var relativePath = subfolder + "/" + fileName;

            var virtualFolder = isParent ? "~/Images/Parents/" : "~/Images/Sitters/";
            var physicalFolder = _mapPath(virtualFolder);
            Directory.CreateDirectory(physicalFolder);
            file.SaveAs(Path.Combine(physicalFolder, fileName));

            return relativePath;
        }
    }
}
