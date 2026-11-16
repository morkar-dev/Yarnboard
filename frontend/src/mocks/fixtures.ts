/**
 * Canned data for Storybook stories (see .storybook/preview.tsx and
 * ./handlers.ts). Shapes come straight from types/models.ts, so a backend
 * shape change that's mirrored there breaks these at type-check time
 * rather than silently drifting.
 */
import type {
  AppNotification,
  HebrewTranslation,
  Pattern,
  PatternDraft,
  PatternNotification,
  PatternShare,
  User,
} from "../types/models";

export const user: User = { id: 1, username: "jane", email: "jane@example.com", is_admin: false };

export const pattern: Pattern = {
  id: 42,
  original_url: "https://example.com/patterns/cozy-raglan",
  has_source_link: true,
  title: "Cozy Raglan Sweater",
  author: "Example Designer",
  source_site_name: "Example Knits",
  source_domain: "example.com",
  materials: "- Yarn: [Worsted wool](https://example.com/yarn), 5 skeins\n- 5mm circular needles\n- Stitch markers",
  abbreviations: "k = knit\np = purl\nm1 = make one",
  instructions: {
    Body: [
      { step: "Cast on 120 stitches.", completed: true },
      { step: "Join in the round and knit 2x2 rib for 5 cm.", completed: false },
      { step: "Knit every round until body measures 35 cm.", completed: false },
    ],
    Sleeves: [
      { step: "Cast on 40 stitches.", completed: false },
      { step: "Knit 2x2 rib for 5 cm.", completed: false },
    ],
  },
  photo_url: null,
  has_photo: false,
  chart_grid: null,
  translations: { he: null, en: null },
  uploader: "jane",
  uploader_id: 1,
  is_public: false,
  created_at: "2026-10-01T10:00:00Z",
  can_edit: true,
  can_manage: true,
};

export const hebrewTranslation: HebrewTranslation = {
  title: "סוודר רגלן נעים",
  materials: "- צמר בעובי worsted, 5 פקעות\n- מסרגות עגולות 5 מ\"מ\n- סמני עין",
  abbreviations: "ש = שמאל\nי = ימין",
  instructions: {
    Body: {
      heading_he: "גוף",
      steps_he: ["העלו 120 עיניים.", "חברו למעגל וסרגו גומי 2x2 לאורך 5 ס\"מ.", "סרגו ימין עד שהגוף באורך 35 ס\"מ."],
    },
    Sleeves: { heading_he: "שרוולים", steps_he: ["העלו 40 עיניים.", "סרגו גומי 2x2 לאורך 5 ס\"מ."] },
  },
  reviewed: false,
};

export const publicPattern: Pattern = { ...pattern, id: 43, is_public: true, title: "Simple Garter Scarf" };

/** No source link, no author -- e.g. pasted as text. */
export const manualPattern: Pattern = {
  ...pattern,
  id: 44,
  original_url: "manual:00000000-0000-0000-0000-000000000000",
  has_source_link: false,
  author: null,
  source_site_name: null,
  source_domain: null,
  title: "Grandma's Dishcloth",
};

export const sharedViewOnlyPattern: Pattern = {
  ...pattern,
  id: 45,
  uploader: "sam",
  uploader_id: 2,
  can_edit: false,
  can_manage: false,
};

export const shares: PatternShare[] = [
  { id: 1, user_id: 2, username: "sam", can_edit: false, created_at: "2026-10-02T10:00:00Z" },
  { id: 2, user_id: 3, username: "lee", can_edit: true, created_at: "2026-10-03T10:00:00Z" },
];

export const draft: PatternDraft = {
  title: "Cozy Raglan Sweater",
  author: "Example Designer",
  materials: "- Worsted wool, 5 skeins\n- 5mm circular needles",
  abbreviations: "k = knit\np = purl",
  instructions: {
    Body: ["Cast on 120 stitches.", "Knit 2x2 rib for 5 cm."],
    Sleeves: ["Cast on 40 stitches."],
  },
  source_site_name: "Example Knits",
  source_domain: "example.com",
  photo_url: null,
};

export const inbox: AppNotification[] = [
  {
    id: 1,
    type: "pattern_shared",
    message: "sam shared “Simple Garter Scarf” with you",
    link: "/pattern/43",
    read: false,
    created_at: "2026-11-10T09:00:00Z",
  },
  {
    id: 2,
    type: "pattern_updated",
    message: "“Cozy Raglan Sweater” was updated",
    link: "/pattern/42",
    read: true,
    created_at: "2026-11-09T09:00:00Z",
  },
];

export const updateNotices: PatternNotification[] = [{ id: 42, title: "Cozy Raglan Sweater" }];
