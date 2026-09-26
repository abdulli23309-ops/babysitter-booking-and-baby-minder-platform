# BACKEND PREFLIGHT — REPOSITORY INVENTORY

> **Branch:** remediation | **Baseline tag:** fyp-baseline-pre-remediation (untouched)  
> **Main/origin/main:** untouched (commit 5cf40d2) | **Audit date:** 2026-09-02  

---

## 1. Repository Structure

```
WebApplication2/
├── App_Start/          (WebApiConfig.cs, SwaggerConfig.cs)
├── Controllers/        (9 controllers)
├── DTOs/               (8 DTO files)
├── Images/             (Children/, Childrens/, Parents/, Sitters/)
├── Models/             (13 entity files + EDMX)
├── Views/              (legacy MVC views)
├── Data/, Content/, App_Data/
├── packages/           (local NuGet)
├── Global.asax(.cs), Web.config, WebApplication2.csproj, .slnx
```

Controllers: ParentController, BabySitterController, JobsController, MatchingController, ReviewController, NotificationsController, CryDetectionController, ChildrenController, ImageController.

DTOs: BabySitterDTOs (LoginDTO, BabysitterRegistrationDTO), ParentDTOs (ParentRegistrationDTO), JobDTOs (SitterDTO, BidDTO, JobDTO, MatchingJobDto), ReviewDTO, CryAlertDto (+ CryAlertRecord), NotificationDto, BulkConfirmDto, AvailabilityDto.

Models: Parent, Babysitter, Job, Bid, Child, Review, Notification, CryAlert, TimeSlot, SitterAvailability, JobTimeSlot + Model1.Context.cs/Designer.cs/edmx.

---

## 2. Technology Inventory

| Component | Version | Evidence |
|-----------|---------|----------|
| .NET Framework | 4.7.2 | csproj TargetFramework |
| ASP.NET Web API | 5.3.0 | packages\Microsoft.AspNet.WebApi.5.3.0 |
| Entity Framework | 6.5.1 | packages\EntityFramework.6.5.1 |
| SQL Server | System.Data.SqlClient | EF6 provider |
| JSON | Newtonsoft.Json 13.0.3 | packages\Newtonsoft.Json.13.0.3 |
| CORS | System.Web.Http.Cors 5.3.0 | EnableCors attribute |
| Swagger | Swashbuckle 5.6.0 | SwaggerConfig + WebActivatorEx |
| Database approach | EDMX Database-First | Model1.edmx + T4 templates |
| Authentication | **None** | No [Authorize], no OWIN, no Identity |
| Logging | **None** | No logging framework |
| Mapping | **None** | Manual property mapping |
| DI Container | **None** | Controllers `new DbContext()` directly |

---

## 3. API Route Inventory (see BACKEND_API_CONTRACT.md for details)

| Controller | Route Prefix | Endpoints |
|------------|--------------|-----------|
| ParentController | api/parent | 6 (register, login, profile, children, create-job, jobs) |
| BabySitterController | api/babysitter | 3 (register, login, earnings) |
| JobsController | api/jobs | 8 (CRUD, sitter-jobs, confirm, status, bulk-confirm) |
| MatchingController | api/matching | 5 (filter-sitters, availability save/clear, babysitter-details, earnings) |
| ReviewController | api/review | 2 (add, user-reviews) |
| NotificationsController | api/notifications | 4 (list, mark-read, clear, create) |
| CryDetectionController | api/cry-detection | 2 (post, latest) |
| ChildrenController | api/children | 2 (add, update) |
| ImageController | api/images | 1 (upload) |

**Total: 33 endpoints across 9 controllers.**
