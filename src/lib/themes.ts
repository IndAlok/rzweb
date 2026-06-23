export type ThemeId =
  | 'rizin-dark'
  | 'midnight'
  | 'nord'
  | 'dracula'
  | 'carbon'
  | 'rizin-light'
  | 'solarized-light';

export type Appearance = 'light' | 'dark';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  appearance: Appearance;
  // Hex preview swatches for the theme picker.
  swatch: { bg: string; surface: string; primary: string; accent: string };
}

export const THEMES: ThemeMeta[] = [
  { id: 'rizin-dark', name: 'Rizin Dark', appearance: 'dark', swatch: { bg: '#0f1521', surface: '#161c28', primary: '#0fa6e9', accent: '#a78bfa' } },
  { id: 'midnight', name: 'Midnight', appearance: 'dark', swatch: { bg: '#0b0f1f', surface: '#121830', primary: '#22d3ee', accent: '#818cf8' } },
  { id: 'nord', name: 'Nord', appearance: 'dark', swatch: { bg: '#2e3440', surface: '#3b4252', primary: '#88c0d0', accent: '#81a1c1' } },
  { id: 'dracula', name: 'Dracula', appearance: 'dark', swatch: { bg: '#282a36', surface: '#343746', primary: '#bd93f9', accent: '#ff79c6' } },
  { id: 'carbon', name: 'Carbon', appearance: 'dark', swatch: { bg: '#121212', surface: '#1a1a1a', primary: '#f5a524', accent: '#f59e0b' } },
  { id: 'rizin-light', name: 'Rizin Light', appearance: 'light', swatch: { bg: '#ffffff', surface: '#f4f7fb', primary: '#0d8ecf', accent: '#7c3aed' } },
  { id: 'solarized-light', name: 'Solarized Light', appearance: 'light', swatch: { bg: '#fdf6e3', surface: '#eee8d5', primary: '#268bd2', accent: '#2aa198' } },
];

export const DEFAULT_DARK_THEME: ThemeId = 'rizin-dark';
export const DEFAULT_LIGHT_THEME: ThemeId = 'rizin-light';

const THEME_MAP = new Map(THEMES.map((t) => [t.id, t]));

export function isThemeId(value: string): value is ThemeId {
  return THEME_MAP.has(value as ThemeId);
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEME_MAP.get(id) ?? THEME_MAP.get(DEFAULT_DARK_THEME)!;
}
