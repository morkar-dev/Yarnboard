import { lazy, Suspense } from "react";
import { Container, Spinner } from "react-bootstrap";
import { Route, Routes } from "react-router-dom";
import Footer from "./components/Footer";
import NavBar from "./components/NavBar";
import ProtectedRoute from "./components/ProtectedRoute";
import UpdateBanner from "./components/UpdateBanner";
import HomePage from "./pages/HomePage";

// Every page but the landing page is its own chunk, so a first visit only
// downloads what the home page needs (the speed audit's "unused JavaScript").
const AdminNewsletterPage = lazy(() => import("./pages/AdminNewsletterPage"));
const CommunityPage = lazy(() => import("./pages/CommunityPage"));
const EditPatternPage = lazy(() => import("./pages/EditPatternPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const MySavedPage = lazy(() => import("./pages/MySavedPage"));
const MyUploadsPage = lazy(() => import("./pages/MyUploadsPage"));
const NotificationSettingsPage = lazy(
  () => import("./pages/NotificationSettingsPage"),
);
const PatternDetailPage = lazy(() => import("./pages/PatternDetailPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ReviewPatternPage = lazy(() => import("./pages/ReviewPatternPage"));
const SharedWithMePage = lazy(() => import("./pages/SharedWithMePage"));
const StitchFiddlePage = lazy(() => import("./pages/StitchFiddlePage"));
const SubmitPatternPage = lazy(() => import("./pages/SubmitPatternPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const UnsubscribePage = lazy(() => import("./pages/UnsubscribePage"));
const UpdatesPage = lazy(() => import("./pages/UpdatesPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));

export default function App() {
  return (
    <>
      <NavBar />
      <UpdateBanner />
      <Container as="main" className="py-4">
        <Suspense
          fallback={
            <div className="d-flex justify-content-center py-5">
              <Spinner animation="border" variant="primary" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/pattern/:id" element={<PatternDetailPage />} />
            <Route
              path="/pattern/:id/edit"
              element={
                <ProtectedRoute>
                  <EditPatternPage />
                </ProtectedRoute>
              }
            />
            <Route path="/submit" element={<SubmitPatternPage />} />
            <Route
              path="/submit/review"
              element={
                <ProtectedRoute>
                  <ReviewPatternPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mine"
              element={
                <ProtectedRoute>
                  <MyUploadsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/saved"
              element={
                <ProtectedRoute>
                  <MySavedPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/shared-with-me"
              element={
                <ProtectedRoute>
                  <SharedWithMePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/stitch-fiddle"
              element={
                <ProtectedRoute>
                  <StitchFiddlePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings/notifications"
              element={
                <ProtectedRoute>
                  <NotificationSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/newsletter"
              element={
                <ProtectedRoute>
                  <AdminNewsletterPage />
                </ProtectedRoute>
              }
            />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route path="/updates" element={<UpdatesPage />} />
          </Routes>
        </Suspense>
      </Container>
      <Footer />
    </>
  );
}
