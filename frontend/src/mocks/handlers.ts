/**
 * Fake Flask API for Storybook (MSW, see .storybook/preview.tsx). Stories
 * never reach a real backend: these defaults describe a quiet logged-out
 * visitor, and a story opts into other states by overriding a group in
 * `parameters.msw.handlers`, e.g.
 *
 *   parameters: { msw: { handlers: { auth: loggedIn, inbox: inboxWith(fixtures.inbox) } } }
 *
 * Grouping by key (auth/inbox/...) lets a story replace one group while
 * keeping every other default.
 */
import { delay, http, HttpResponse } from "msw";
import * as fixtures from "./fixtures";
import type { AppNotification, Pattern, PatternNotification, PatternShare, PreviewResponse } from "../types/models";

const api = (path: string) => `*/api${path}`;

export const loggedOut = [
  http.get(api("/profile"), () => HttpResponse.json({ error: "Not logged in", code: "not_logged_in" }, { status: 401 })),
];

export const loggedIn = [http.get(api("/profile"), () => HttpResponse.json(fixtures.user))];

export const inboxWith = (items: AppNotification[]) => [
  http.get(api("/notifications"), () => HttpResponse.json(items)),
  http.post(api("/notifications/:id/read"), ({ params }) =>
    HttpResponse.json({ ...items.find((n) => n.id === Number(params.id)), read: true }),
  ),
  http.post(api("/notifications/read-all"), () => HttpResponse.json({ message: "ok" })),
];

export const updateNoticesWith = (items: PatternNotification[]) => [
  http.get(api("/patterns/notifications"), () => HttpResponse.json(items)),
  http.post(api("/patterns/:id/acknowledge-update"), () => HttpResponse.json({ message: "ok" })),
];

export const progressOk = [
  http.patch(api("/patterns/:id/progress"), () => HttpResponse.json({ completed_steps: {} })),
  http.delete(api("/patterns/:id/progress"), () => HttpResponse.json({ completed_steps: {} })),
];

export const progressFails = [
  http.patch(api("/patterns/:id/progress"), () =>
    HttpResponse.json({ error: "Server error", code: "server_error" }, { status: 500 }),
  ),
];

export const sharesWith = (initial: PatternShare[]) => {
  let shares = [...initial];
  return [
    http.get(api("/patterns/:id/shares"), () => HttpResponse.json(shares)),
    http.post(api("/patterns/:id/shares"), async ({ request }) => {
      const body = (await request.json()) as { username: string; can_edit?: boolean };
      if (body.username === "nobody") {
        return HttpResponse.json({ error: "User not found", code: "user_not_found" }, { status: 404 });
      }
      shares = [
        ...shares,
        { id: shares.length + 10, user_id: shares.length + 10, username: body.username, can_edit: !!body.can_edit, created_at: null },
      ];
      return HttpResponse.json(shares);
    }),
    http.patch(api("/patterns/:id/shares/:userId"), async ({ params, request }) => {
      const body = (await request.json()) as { can_edit: boolean };
      shares = shares.map((s) => (s.user_id === Number(params.userId) ? { ...s, can_edit: body.can_edit } : s));
      return HttpResponse.json(shares);
    }),
    http.delete(api("/patterns/:id/shares/:userId"), ({ params }) => {
      shares = shares.filter((s) => s.user_id !== Number(params.userId));
      return HttpResponse.json({ message: "ok" });
    }),
  ];
};

export const publishing = [
  http.post(api("/patterns/:id/publish"), () =>
    HttpResponse.json({ message: "ok", pattern: { ...fixtures.pattern, is_public: true } }),
  ),
  http.post(api("/patterns/:id/unpublish"), () =>
    HttpResponse.json({ message: "ok", pattern: { ...fixtures.pattern, is_public: false } }),
  ),
  http.delete(api("/patterns/:id"), () => HttpResponse.json({ message: "ok" })),
];

const previewOk: PreviewResponse = {
  duplicate: false,
  existing_pattern_id: null,
  already_shared_with_you: null,
  draft: fixtures.draft,
};

export const previewSucceeds = [
  http.post(api("/patterns/preview-text"), () => HttpResponse.json(previewOk)),
  http.post(api("/patterns/preview-photos"), () => HttpResponse.json(previewOk)),
];

export const previewFails = [
  http.post(api("/patterns/preview-text"), () =>
    HttpResponse.json({ error: "Couldn't read a pattern from that text.", code: "parse_failed" }, { status: 422 }),
  ),
  http.post(api("/patterns/preview-photos"), () =>
    HttpResponse.json({ error: "Couldn't read a pattern from those photos.", code: "parse_failed" }, { status: 422 }),
  ),
];

/** Never resolves within a story's lifetime -- for loading states. */
export const previewPending = [
  http.post(api("/patterns/preview-text"), async () => {
    await delay("infinite");
    return HttpResponse.json(previewOk);
  }),
  http.post(api("/patterns/preview-photos"), async () => {
    await delay("infinite");
    return HttpResponse.json(previewOk);
  }),
];

export const patternIs = (p: Pattern) => [http.get(api("/patterns/:id"), () => HttpResponse.json(p))];

export const patternNotFound = [
  http.get(api("/patterns/:id"), () => HttpResponse.json({ error: "Not found", code: "not_found" }, { status: 404 })),
];

export const patternLoading = [
  http.get(api("/patterns/:id"), async () => {
    await delay("infinite");
    return HttpResponse.json(fixtures.pattern);
  }),
];

/** Machine translation "succeeds" with an unreviewed Hebrew overlay. */
export const translateSucceeds = [
  http.post(api("/patterns/:id/translate"), () =>
    HttpResponse.json({
      message: "ok",
      pattern: { ...fixtures.pattern, translations: { en: null, he: fixtures.hebrewTranslation } },
    }),
  ),
];

export const translateFails = [
  http.post(api("/patterns/:id/translate"), () =>
    HttpResponse.json({ error: "Translation service unavailable", code: "translation_failed" }, { status: 502 }),
  ),
];

/** URL preview (the Submit page's "From a link" mode). */
export const linkPreviewSucceeds = [
  http.post(api("/patterns/preview"), () => HttpResponse.json(previewOk)),
];

export const linkPreviewDuplicate = [
  http.post(api("/patterns/preview"), () =>
    HttpResponse.json({ duplicate: true, existing_pattern_id: 43, already_shared_with_you: null, draft: null }),
  ),
];

export const linkPreviewBlocked = [
  http.post(api("/patterns/preview"), () =>
    HttpResponse.json({ error: "403 Forbidden", code: "fetch_failed" }, { status: 502 }),
  ),
];

export const saveEditSucceeds = [
  http.patch(api("/patterns/:id"), async ({ request }) => {
    const body = (await request.json()) as Partial<Pattern>;
    return HttpResponse.json({ message: "ok", pattern: { ...fixtures.pattern, ...body } });
  }),
];

export const saveEditFails = [
  http.patch(api("/patterns/:id"), () =>
    HttpResponse.json({ error: "Instructions don't match the translation", code: "translation_mismatch" }, { status: 400 }),
  ),
];

export const defaultHandlers = {
  auth: loggedOut,
  inbox: inboxWith([]),
  updates: updateNoticesWith([]),
  progress: progressOk,
  shares: sharesWith(fixtures.shares),
  publishing,
  preview: previewSucceeds,
  linkPreview: linkPreviewSucceeds,
  pattern: patternIs(fixtures.pattern),
  translate: translateSucceeds,
  saveEdit: saveEditSucceeds,
};
