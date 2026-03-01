export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "invoicey-theme";

const isTheme = (value: string | null): value is Theme => {
  return value === "light" || value === "dark";
};

export const applyTheme = (theme: Theme) => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
};

export const resolveThemePreference = (): Theme => {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isTheme(storedTheme)) {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export const THEME_INIT_SCRIPT = `
(() => {
  try {
    const key = "${THEME_STORAGE_KEY}";
    const storedTheme = localStorage.getItem(key);
    const isStoredThemeValid = storedTheme === "light" || storedTheme === "dark";
    const resolvedTheme = isStoredThemeValid
      ? storedTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.style.colorScheme = resolvedTheme;
  } catch {}
})();
`;
