using System;
using System.Collections.Generic;
using System.Web.Http.Dependencies;
using WebApplication2.Controllers;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Lightweight dependency resolver for Web API controllers and extracted services.
    /// Does not introduce external IoC containers while allowing constructor injection.
    /// </summary>
    public class SimpleDependencyResolver : IDependencyResolver
    {
        public IDependencyScope BeginScope()
        {
            return this;
        }

        public object GetService(Type serviceType)
        {
            if (serviceType == typeof(MatchingController))
            {
                return new MatchingController(new AvailabilityService(), new MatchingService(), new RecurringAvailabilityService());
            }

            if (serviceType == typeof(ParentController))
            {
                return new ParentController(new AccountService(), new ChildService(), new JobService());
            }

            if (serviceType == typeof(BabysitterController))
            {
                return new BabysitterController(new AccountService());
            }

            if (serviceType == typeof(ChildrenController))
            {
                return new ChildrenController(new ChildService());
            }

            if (serviceType == typeof(JobsController))
            {
                return new JobsController(new JobService());
            }

            if (serviceType == typeof(BidsController))
            {
                return new BidsController(new BidService());
            }

            if (serviceType == typeof(ReviewController))
            {
                return new ReviewController(new ReviewService());
            }

            if (serviceType == typeof(NotificationsController))
            {
                return new NotificationsController(new NotificationService());
            }

            // PHASE 11 REMOVAL: the legacy CryDetectionController (api/cry-detection)
            // and its CryAlertService are gone. That path inserted cry alerts
            // through the STALE EDMX CryAlert mapping, leaving
            // NextEscalationDueAt = NULL so the sweeper could never escalate or
            // notify them - a silent false-success pipeline. The single live cry
            // pipeline is now MonitoringController -> CryIncidentService, which
            // writes the same CryAlert TABLE with parameterized raw SQL and owns
            // incident creation, T+5, T+15, acknowledgement, resolution and
            // dedupe. Do not reintroduce a second cry pipeline here.

            if (serviceType == typeof(MonitoringController))
            {
                return new MonitoringController(
                    new MonitoringService(), new CryIncidentService(), new GuardianConnectionService());
            }

            if (serviceType == typeof(ImageController))
            {
                return new ImageController(new ImageService());
            }

            if (serviceType == typeof(IAvailabilityService))
            {
                return new AvailabilityService();
            }

            if (serviceType == typeof(IRecurringAvailabilityService))
            {
                return new RecurringAvailabilityService();
            }

            if (serviceType == typeof(IMatchingService))
            {
                return new MatchingService();
            }

            if (serviceType == typeof(IAccountService))
            {
                return new AccountService();
            }

            if (serviceType == typeof(IChildService))
            {
                return new ChildService();
            }

            if (serviceType == typeof(IJobService))
            {
                return new JobService();
            }

            if (serviceType == typeof(IBidService))
            {
                return new BidService();
            }

            if (serviceType == typeof(IReviewService))
            {
                return new ReviewService();
            }

            if (serviceType == typeof(INotificationService))
            {
                return new NotificationService();
            }

            // PHASE 11 REMOVAL: ICryAlertService / CryAlertService registration
            // removed with the legacy api/cry-detection pipeline. Cry incident
            // behaviour now lives solely in ICryIncidentService / CryIncidentService.

            if (serviceType == typeof(IMonitoringService))
            {
                return new MonitoringService();
            }

            if (serviceType == typeof(IImageService))
            {
                return new ImageService();
            }

            return null;
        }

        public IEnumerable<object> GetServices(Type serviceType)
        {
            return new List<object>();
        }

        public void Dispose()
        {
        }
    }
}
