(() => {
  const context = document.getElementById("context");
  const picker = document.getElementById("project-picker");
  if (location.pathname !== "/" || !context || !picker || context.dataset.mwProjectTitle) return;
  context.dataset.mwProjectTitle = "true";
  const defaultTitle = document.title;
  const updateTitle = () => {
    const name = context.title.trim();
    const title = name && name !== "\u672c\u5730\u9879\u76ee" ? name : defaultTitle;
    if (document.title !== title) document.title = title;
  };
  new MutationObserver(updateTitle).observe(context, { attributeFilter: ["title"] });
  updateTitle();
})();
