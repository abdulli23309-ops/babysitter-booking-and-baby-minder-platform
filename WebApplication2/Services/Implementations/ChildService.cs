using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web;
using WebApplication2.DTOs;
using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Services.Implementations
{
    public class ChildService : IChildService, IDisposable
    {
        private readonly BabySitterBooking_and_BabyMinderEntities _db;
        private readonly bool _ownsContext;

        public ChildService() : this(new BabySitterBooking_and_BabyMinderEntities(), ownsContext: true)
        {
        }

        public ChildService(BabySitterBooking_and_BabyMinderEntities db, bool ownsContext = false)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _ownsContext = ownsContext;
        }

        public IEnumerable<ChildDto> GetChildrenByParent(int parentId)
        {
            if (parentId <= 0)
                throw new ArgumentException("Parent ID must be a positive integer.");

            return _db.Children
                .Where(c => c.Parent_ID == parentId && !c.IsDeleted)
                .Select(c => new ChildDto
                {
                    Child_ID = c.Child_ID,
                    Parent_ID = c.Parent_ID,
                    ChildName = c.ChildName,
                    DOB = c.DOB,
                    Gender = c.Gender,
                    SpecialRequirements = c.SpecialRequirements,
                    SpecialNote = c.SpecialRequirements,
                    PictureAddress = c.PictureAddress,
                    GuardianName = c.GuardianName,
                    GuardianRelation = c.GuardianRelation,
                    GuardianContact = c.GuardianContact
                })
                .ToList();
        }

        public ChildOperationResult CreateChild(HttpRequest request)
        {
            if (request == null || request.Form == null)
                throw new ArgumentException("Request body is required.");

            if (!int.TryParse(request.Form["ParentId"], out int parentId) || parentId <= 0)
                throw new ArgumentException("Valid ParentId is required.");

            string childName = request.Form["ChildName"];
            string dobStr = request.Form["DOB"];
            string gender = request.Form["Gender"] ?? "Male";
            string special = request.Form["SpecialRequirements"] 
                ?? request.Form["specialNote"] 
                ?? request.Form["SpecialNote"];
            string guardianName = request.Form["GuardianName"];
            string guardianRelation = request.Form["GuardianRelation"];
            string guardianContact = request.Form["GuardianContact"];
            bool useDefault = request.Form["UseDefaultPicture"] == "true";

            DateTime dob;
            if (!DateTime.TryParse(dobStr, out dob))
                dob = new DateTime(2023, 1, 1);

            var postedFile = request.Files.Count > 0 ? request.Files[0] : null;

            var dto = new CreateChildDto
            {
                ParentId = parentId,
                ChildName = childName,
                DOB = dob,
                Gender = gender,
                SpecialRequirements = special,
                SpecialNote = special,
                GuardianName = guardianName,
                GuardianRelation = guardianRelation,
                GuardianContact = guardianContact
            };

            return CreateChild(dto, postedFile, useDefault);
        }

        public ChildOperationResult CreateChild(CreateChildDto dto, HttpPostedFile postedFile, bool useDefaultPicture)
        {
            if (dto == null)
                throw new ArgumentNullException(nameof(dto));

            if (dto.ParentId <= 0)
                throw new ArgumentException("Valid ParentId is required.");

            if (string.IsNullOrWhiteSpace(dto.ChildName))
                throw new ArgumentException("Child name is required.");

            if (dto.ChildName.Trim().Length > 150)
                throw new ArgumentException("Child name must not exceed 150 characters.");

            string fileName;
            if (useDefaultPicture || postedFile == null || postedFile.ContentLength == 0)
            {
                fileName = "default_child.jpg";
            }
            else
            {
                string ext = Path.GetExtension(postedFile.FileName)?.ToLowerInvariant();
                if (ext != ".jpg" && ext != ".jpeg" && ext != ".png")
                    throw new ArgumentException("Only JPG/PNG images are allowed.");

                fileName = Guid.NewGuid().ToString() + ext;
                string folderPath = GetChildrenImageFolder();
                if (!Directory.Exists(folderPath))
                    Directory.CreateDirectory(folderPath);

                string fullPath = Path.Combine(folderPath, fileName);
                postedFile.SaveAs(fullPath);
            }

            string specialRequirements = !string.IsNullOrWhiteSpace(dto.SpecialRequirements)
                ? dto.SpecialRequirements
                : dto.SpecialNote;

            var child = new Child
            {
                Parent_ID = dto.ParentId,
                ChildName = dto.ChildName.Trim(),
                DOB = dto.DOB,
                Gender = dto.Gender ?? "Male",
                SpecialRequirements = specialRequirements,
                PictureAddress = "Children/" + fileName,
                GuardianName = dto.GuardianName,
                GuardianRelation = dto.GuardianRelation,
                GuardianContact = dto.GuardianContact,
                IsDeleted = false
            };

            _db.Children.Add(child);
            _db.SaveChanges();

            return new ChildOperationResult
            {
                Success = true,
                Message = "Child added successfully",
                ChildId = child.Child_ID
            };
        }

        public ChildOperationResult UpdateChild(int childId, HttpRequest request, int currentUserId)
        {
            if (request == null || request.Form == null)
                throw new ArgumentException("Request body is required.");

            string childName = request.Form["ChildName"];
            string dobStr = request.Form["DOB"];
            string gender = request.Form["Gender"];
            string special = request.Form["SpecialRequirements"] 
                ?? request.Form["specialNote"] 
                ?? request.Form["SpecialNote"];
            string guardianName = request.Form["GuardianName"];
            string guardianRelation = request.Form["GuardianRelation"];
            string guardianContact = request.Form["GuardianContact"];
            bool useDefault = request.Form["UseDefaultPicture"] == "true";

            var postedFile = request.Files.Count > 0 ? request.Files[0] : null;

            var dto = new UpdateChildDto
            {
                ChildName = childName,
                DOB = dobStr,
                Gender = gender,
                SpecialRequirements = special,
                SpecialNote = special,
                GuardianName = guardianName,
                GuardianRelation = guardianRelation,
                GuardianContact = guardianContact
            };

            return UpdateChild(childId, dto, postedFile, useDefault, currentUserId);
        }

        public ChildOperationResult UpdateChild(int childId, UpdateChildDto dto, HttpPostedFile postedFile, bool useDefaultPicture, int currentUserId)
        {
            if (childId <= 0)
                throw new ArgumentException("Valid Child ID is required.");

            var child = _db.Children.FirstOrDefault(c => c.Child_ID == childId && !c.IsDeleted);
            if (child == null)
                throw new KeyNotFoundException("Child not found.");

            if (currentUserId > 0 && child.Parent_ID != currentUserId)
                throw new UnauthorizedAccessException("Access denied: you may only update your own child.");

            if (dto != null)
            {
                if (!string.IsNullOrWhiteSpace(dto.ChildName))
                    child.ChildName = dto.ChildName.Trim();

                if (!string.IsNullOrWhiteSpace(dto.DOB) && DateTime.TryParse(dto.DOB, out DateTime dob))
                    child.DOB = dob;

                if (!string.IsNullOrWhiteSpace(dto.Gender))
                    child.Gender = dto.Gender;

                string updatedSpecial = dto.SpecialRequirements ?? dto.SpecialNote;
                if (updatedSpecial != null)
                    child.SpecialRequirements = updatedSpecial.Trim();

                if (dto.GuardianName != null)
                    child.GuardianName = dto.GuardianName.Trim();

                if (dto.GuardianRelation != null)
                    child.GuardianRelation = dto.GuardianRelation.Trim();

                if (dto.GuardianContact != null)
                    child.GuardianContact = dto.GuardianContact.Trim();
            }

            if (!useDefaultPicture && postedFile != null && postedFile.ContentLength > 0)
            {
                string ext = Path.GetExtension(postedFile.FileName)?.ToLowerInvariant();
                if (ext != ".jpg" && ext != ".jpeg" && ext != ".png")
                    throw new ArgumentException("Only JPG/PNG images are allowed.");

                string fileName = Guid.NewGuid().ToString() + ext;
                string folderPath = GetChildrenImageFolder();
                if (!Directory.Exists(folderPath))
                    Directory.CreateDirectory(folderPath);

                string fullPath = Path.Combine(folderPath, fileName);
                postedFile.SaveAs(fullPath);
                child.PictureAddress = "Children/" + fileName;
            }
            else if (useDefaultPicture)
            {
                child.PictureAddress = "Children/default_child.jpg";
            }

            _db.SaveChanges();

            return new ChildOperationResult
            {
                Success = true,
                Message = "Child updated successfully",
                ChildId = child.Child_ID
            };
        }

        public void DeleteChild(int childId, int currentUserId)
        {
            if (childId <= 0)
                throw new ArgumentException("Child ID must be a positive integer.");

            var child = _db.Children.FirstOrDefault(c => c.Child_ID == childId && !c.IsDeleted);
            if (child == null)
                throw new KeyNotFoundException("Child not found.");

            if (currentUserId > 0 && child.Parent_ID != currentUserId)
                throw new UnauthorizedAccessException("You are not allowed to delete this child.");

            child.IsDeleted = true;
            _db.SaveChanges();
        }

        private static string GetChildrenImageFolder()
        {
            if (HttpContext.Current != null && HttpContext.Current.Server != null)
            {
                return HttpContext.Current.Server.MapPath("~/Images/Children/");
            }
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Images", "Children");
        }

        public void Dispose()
        {
            if (_ownsContext)
            {
                _db.Dispose();
            }
        }
    }
}
