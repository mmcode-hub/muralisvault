// This journal intentionally uses one light palette, independent of browser storage.
document.documentElement.classList.remove("dark");
window.addEventListener("DOMContentLoaded", () => {
  document.querySelector('meta[name="theme-color"]').content = "#f7f4ee";
});
