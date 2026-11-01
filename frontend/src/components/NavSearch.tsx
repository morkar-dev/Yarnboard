/**
 * Navbar pattern search: a search-icon button that expands into a text
 * box about half the navbar row wide. On md+ screens the box floats over
 * the nav links instead of pushing them (a logged-in navbar has no free
 * room for it); inside the collapsed mobile menu it's simply full width.
 * Submitting goes to /community?q=..., which filters the community
 * library server-side (see GET /api/patterns/community's `q`). Escape or
 * clicking away collapses it; the typed query is kept for next time, and
 * the community page itself shows what was searched.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Form } from "react-bootstrap";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { SearchIcon } from "./Icons";

export default function NavSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const currentQuery = pathname === "/community" ? (searchParams.get("q") ?? "") : "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(currentQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the box in step with the URL (back/forward, the community
  // page's own "clear search" link).
  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!open) {
      setOpen(true);
      return;
    }
    const q = query.trim();
    navigate(q ? `/community?q=${encodeURIComponent(q)}` : "/community");
    setOpen(false);
  }

  return (
    <Form role="search" onSubmit={handleSubmit} className={`nav-search d-flex flex-row align-items-center ${open ? "open" : ""}`}>
      {open && (
        <Form.Control
          ref={inputRef}
          type="search"
          size="sm"
          dir="auto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          onBlur={() => setOpen(false)}
          placeholder={t("nav.searchPlaceholder")}
          aria-label={t("nav.searchPlaceholder")}
        />
      )}
      <Button
        type="submit"
        variant="outline-light"
        size="sm"
        className="d-inline-flex align-items-center flex-shrink-0"
        aria-label={open ? t("nav.searchSubmit") : t("nav.searchOpen")}
        title={open ? t("nav.searchSubmit") : t("nav.searchOpen")}
        // Keep the input's onBlur from collapsing the box before this
        // click registers as a submit.
        onMouseDown={(e) => e.preventDefault()}
      >
        <SearchIcon size={16} />
      </Button>
    </Form>
  );
}
