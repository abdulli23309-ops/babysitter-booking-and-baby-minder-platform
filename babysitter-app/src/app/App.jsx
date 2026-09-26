import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthContext';
import { ToastProvider } from '../components/ui/ToastContext';
import AppLayout from '../components/layout/AppLayout';
import NotFoundScreen from '../features/error/NotFoundScreen';
import ErrorBoundary from '../features/error/ErrorBoundary';
import ProtectedRoute from './ProtectedRoute';
import Splash from '../features/auth/Splash';
import RoleSelection from '../features/auth/RoleSelection';
import Login from '../features/auth/Login';
import Register from '../features/auth/Register';
import CreateAccount from '../features/auth/CreateAccount';
import ParentDashboard from '../features/parent/ParentDashboard';
import BabysitterDashboard from '../features/babysitter/BabySitterDashboard';
import MainScreen from '../features/parent/MainScreen';
import JobRequest from '../features/babysitter/JobRequest';
import SetAvailability from '../features/babysitter/SetAvailability';
import SetChildProfile from '../features/parent/SetChildProfile';
import BabySitterDetails from '../features/parent/BabySitterDetails';
import ChildProfile from '../features/parent/ChildProfile';
import ParentProfileScreen from '../features/parent/ParentProfileScreen';
import SearchBabysitter from '../features/parent/SearchBabySitter';
import MyJobsScreen from '../features/parent/MyJobsScreen';
import BookingStatus from '../features/parent/BookingStatus';
import UpdateChildProfileScreen from '../features/parent/UpdateChildProfileScreen';
import ParentActiveJobScreen from '../features/parent/ParentActiveJobScreen';
import ParentUpcomingJobScreen from '../features/parent/ParentUpcomingJobScreen';
import MyProfile from '../features/babysitter/babysitterprofilescreen';
import UpdateProfile from '../features/babysitter/UpdateProfile';
import ActiveJobDetails from '../features/babysitter/ActiveJobDetails';
import Earnings from '../features/babysitter/Earnings';
import CompletedJobDetails from '../features/babysitter/CompletedJobDetails';
import JobDetails from '../features/babysitter/JobDetails';
import JobRequestedSuccess from '../features/parent/JobRequestedSuccess';
import ParentNotifications from '../features/notifications/ParentNotifications';
import BabysitterNotifications from '../features/notifications/BabysitterNotifications';
import Ratings from '../features/reviews/Ratings';
import JobEndReviewScreen from '../features/reviews/JobEndReviewScreen';
import JobAcceptedSuccess from '../features/babysitter/JobAcceptedSuccess';
import BabysitterMyJobs from '../features/babysitter/BabysitterMyJobs';
import UpcomingJobDetails from '../features/babysitter/UpcomingJobDetails';
import CryDetector from '../features/cry/CryDetector';
import BabyMonitoringScreen from '../features/parent/BabyMonitoringScreen';
import ChildCryAlertScreen from '../features/parent/ChildCryAlertScreen';
import SupportScreen from '../features/support/SupportScreen';

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <AppLayout>
            <Routes>
              {/* ---- Public routes ---- */}
              <Route path="/" element={<Splash />} />
              <Route path="/role" element={<RoleSelection />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/create-account" element={<CreateAccount />} />

              {/* ---- Parent-protected routes ---- */}
              <Route path="/parent-dashboard" element={<ProtectedRoute allowedRoles={['parent']}><ParentDashboard /></ProtectedRoute>} />
              <Route path="/main-screen" element={<ProtectedRoute allowedRoles={['parent']}><MainScreen /></ProtectedRoute>} />
              <Route path="/set-child-profile" element={<ProtectedRoute allowedRoles={['parent']}><SetChildProfile /></ProtectedRoute>} />
              <Route path="/babysitter-details" element={<ProtectedRoute allowedRoles={['parent']}><BabySitterDetails /></ProtectedRoute>} />
              <Route path="/child-profile" element={<ProtectedRoute allowedRoles={['parent']}><ChildProfile /></ProtectedRoute>} />
              <Route path="/parent-profile" element={<ProtectedRoute allowedRoles={['parent']}><ParentProfileScreen /></ProtectedRoute>} />
              <Route path="/search-babysitter" element={<ProtectedRoute allowedRoles={['parent']}><SearchBabysitter /></ProtectedRoute>} />
              <Route path="/my-jobs" element={<ProtectedRoute allowedRoles={['parent']}><MyJobsScreen /></ProtectedRoute>} />
              <Route path="/booking-status/:jobId" element={<ProtectedRoute allowedRoles={['parent']}><BookingStatus /></ProtectedRoute>} />
              <Route path="/update-child-profile" element={<ProtectedRoute allowedRoles={['parent']}><UpdateChildProfileScreen /></ProtectedRoute>} />
              <Route path="/parent-active-job" element={<ProtectedRoute allowedRoles={['parent']}><ParentActiveJobScreen /></ProtectedRoute>} />
              <Route
                path="/parent-active-job/:jobId"
                element={
                  <ProtectedRoute allowedRoles={['parent']}>
                    <ParentActiveJobScreen />
                  </ProtectedRoute>
                }
              />
              <Route path="/parent-upcoming-job" element={<ProtectedRoute allowedRoles={['parent']}><ParentUpcomingJobScreen /></ProtectedRoute>} />
              <Route path="/job-requested-success" element={<ProtectedRoute allowedRoles={['parent']}><JobRequestedSuccess /></ProtectedRoute>} />
              <Route path="/parent-notifications" element={<ProtectedRoute allowedRoles={['parent']}><ParentNotifications /></ProtectedRoute>} />
              <Route
                path="/job-review/:jobId"
                element={
                  <ProtectedRoute allowedRoles={['parent', 'babysitter']}>
                    <JobEndReviewScreen />
                  </ProtectedRoute>
                }
              />
              <Route path="/baby-monitoring" element={<ProtectedRoute allowedRoles={['parent']}><BabyMonitoringScreen /></ProtectedRoute>} />
              <Route path="/cry-alert" element={<ProtectedRoute allowedRoles={['parent']}><ChildCryAlertScreen /></ProtectedRoute>} />

              {/* ---- Babysitter-protected routes ---- */}
              <Route path="/babysitter-dashboard" element={<ProtectedRoute allowedRoles={['babysitter']}><BabysitterDashboard /></ProtectedRoute>} />
              <Route path="/job-request" element={<ProtectedRoute allowedRoles={['babysitter']}><JobRequest /></ProtectedRoute>} />
              <Route path="/set-availability" element={<ProtectedRoute allowedRoles={['babysitter']}><SetAvailability /></ProtectedRoute>} />
              <Route path="/my-profile" element={<ProtectedRoute allowedRoles={['babysitter']}><MyProfile /></ProtectedRoute>} />
              <Route path="/update-profile" element={<ProtectedRoute allowedRoles={['babysitter']}><UpdateProfile /></ProtectedRoute>} />
              <Route path="/active-job-details" element={<ProtectedRoute allowedRoles={['babysitter']}><ActiveJobDetails /></ProtectedRoute>} />
              <Route path="/completed-job-details" element={<ProtectedRoute allowedRoles={['babysitter']}><CompletedJobDetails /></ProtectedRoute>} />
              <Route path="/completed-job-details/:jobId" element={<ProtectedRoute allowedRoles={['babysitter']}><CompletedJobDetails /></ProtectedRoute>} />
              <Route path="/job-details" element={<ProtectedRoute allowedRoles={['babysitter']}><JobDetails /></ProtectedRoute>} />
              <Route path="/job-details/:jobId" element={<ProtectedRoute allowedRoles={['babysitter']}><JobDetails /></ProtectedRoute>} />
              <Route path="/earnings" element={<ProtectedRoute allowedRoles={['babysitter']}><Earnings /></ProtectedRoute>} />
              <Route path="/ratings" element={<ProtectedRoute allowedRoles={['babysitter']}><Ratings /></ProtectedRoute>} />
              <Route path="/babysitter-notifications" element={<ProtectedRoute allowedRoles={['babysitter']}><BabysitterNotifications /></ProtectedRoute>} />
              <Route path="/job-accepted-success" element={<ProtectedRoute allowedRoles={['babysitter']}><JobAcceptedSuccess /></ProtectedRoute>} />
              <Route path="/babysitter-my-jobs" element={<ProtectedRoute allowedRoles={['babysitter']}><BabysitterMyJobs /></ProtectedRoute>} />
              <Route path="/upcoming-job-details" element={<ProtectedRoute allowedRoles={['babysitter']}><UpcomingJobDetails /></ProtectedRoute>} />
              <Route path="/upcoming-job-details/:jobId" element={<ProtectedRoute allowedRoles={['babysitter']}><UpcomingJobDetails /></ProtectedRoute>} />
              <Route path="/child-cry-alert" element={<ProtectedRoute allowedRoles={['parent']}><ChildCryAlertScreen /></ProtectedRoute>} />

              {/* ---- Shared / ambiguous routes (both roles may access) ---- */}
              <Route path="/cry-detector" element={<ProtectedRoute><CryDetector /></ProtectedRoute>} />
              <Route path="/support" element={<ProtectedRoute><SupportScreen /></ProtectedRoute>} />

              {/* ---- Dead Route Aliases / Redirects (FE-011) ---- */}
              <Route path="/parent-home" element={<Navigate to="/parent-dashboard" replace />} />
              <Route path="/parent-my-jobs" element={<Navigate to="/my-jobs" replace />} />
              <Route path="/post-job" element={<Navigate to="/my-jobs" replace />} />
              <Route path="/monitor" element={<Navigate to="/baby-monitoring" replace />} />
              <Route path="/child-job-profile" element={<Navigate to="/child-profile" replace />} />
              <Route path="/sitter-profile" element={<Navigate to="/search-babysitter" replace />} />
              <Route path="/update-parent-profile" element={<Navigate to="/parent-profile" replace />} />
              <Route path="/messages" element={<Navigate to="/babysitter-notifications" replace />} />
              <Route path="/notifications" element={<Navigate to="/babysitter-notifications" replace />} />
                            <Route path="/more" element={<Navigate to="/parent-dashboard" replace />} />

              {/* ---- 404 Catch-all (unmatched routes) ---- */}
              <Route path="*" element={<NotFoundScreen />} />
            </Routes>
          </AppLayout>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;

