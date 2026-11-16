/**
 * UI text for Storybook play functions, in whatever language the story is
 * running in (the Language toolbar, or the visual tests' Hebrew pass).
 * Steps must find buttons and labels through these -- never by hard-coded
 * English -- or they can't run in Hebrew, and the Hebrew screenshots
 * would show the page before the steps instead of after them.
 *
 * Called at play time (not at module load), so the language switch done
 * by .storybook/preview.tsx's loader has already happened.
 */
import i18n from "../i18n";

/** The translated string for `key`, with `{{placeholders}}` filled in. */
export function t(key: string, options?: Record<string, unknown>): string {
  const text = i18n.t(key, options);
  if (text === key) throw new Error(`Missing translation key in a story: ${key}`);
  return text;
}

/** A regular expression matching the translated text anywhere -- for an
 * accessible name that also contains something else (a badge count). */
export function tMatch(key: string, options?: Record<string, unknown>): RegExp {
  return new RegExp(t(key, options).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** A regular expression matching exactly the translated text. */
export function tExact(key: string, options?: Record<string, unknown>): RegExp {
  return new RegExp(`^${t(key, options).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}
