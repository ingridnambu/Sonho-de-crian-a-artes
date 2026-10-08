"use strict";

const THEME_STORAGE_KEY = "sonhoDeCrianca.theme";
const themePreference = (() => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.warn("Não foi possível ler a preferência de tema:", error);
    return null;
  }
})();
let activeTheme = themePreference === "dark" ? "dark" : "light";

function applyTheme(theme) {
  activeTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    const isDark = theme === "dark";
    button.innerHTML = isDark
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z"></path></svg>';
    button.setAttribute("aria-label", isDark ? "Ativar modo claro" : "Ativar modo escuro");
    button.setAttribute("aria-pressed", String(isDark));
    button.title = isDark ? "Ativar modo claro" : "Ativar modo escuro";
  });

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === "dark" ? "#24465b" : "#c5f4f6";
}

applyTheme(activeTheme);
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(activeTheme);
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTheme = activeTheme === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch (error) {
        console.warn("Não foi possível salvar a preferência de tema:", error);
      }
    });
  });
});
