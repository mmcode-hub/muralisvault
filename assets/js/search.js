// Based on Blowfish v3.9.0 (MIT). Local changes: input/paste events, async first query, empty-state feedback,
// escaped results, single index request with error feedback.
var fuse;
var showButton = document.getElementById("search-button");
var showButtonMobile = document.getElementById("search-button-mobile");
var hideButton = document.getElementById("close-search-button");
var wrapper = document.getElementById("search-wrapper");
var modal = document.getElementById("search-modal");
var input = document.getElementById("search-query");
var output = document.getElementById("search-results");
var first = output.firstChild;
var last = output.lastChild;
var searchVisible = false;
var indexed = false;
var indexing = false;
var hasResults = false;
var previouslyFocused = null;

// Listen for events
showButton ? showButton.addEventListener("click", displaySearch) : null;
showButtonMobile
  ? showButtonMobile.addEventListener("click", displaySearch)
  : null;
hideButton.addEventListener("click", hideSearch);
wrapper.addEventListener("click", hideSearch);
modal.addEventListener("click", function (event) {
  event.stopPropagation();
  event.stopImmediatePropagation();
  return false;
});
const shortcutHint = document.getElementById("search-shortcut-hint");
if (shortcutHint && !/Mac|iPhone|iPad/.test(navigator.platform)) {
  shortcutHint.textContent = "Ctrl K";
}

document.addEventListener("keydown", function (event) {
  // Forward slash to open search wrapper
  if (event.key == "/") {
    const active = document.activeElement;
    const tag = active.tagName;
    const isInputField =
      tag === "INPUT" || tag === "TEXTAREA" || active.isContentEditable;

    if (!searchVisible && !isInputField) {
      event.preventDefault();
      displaySearch();
    }
  }

  // Cmd+K (macOS) / Ctrl+K to toggle search wrapper
  if (
    event.key &&
    event.key.toLowerCase() == "k" &&
    (event.metaKey || event.ctrlKey)
  ) {
    event.preventDefault();
    if (searchVisible) {
      hideSearch();
    } else {
      displaySearch();
    }
  }

  // Esc to close search wrapper
  if (event.key == "Escape") {
    hideSearch();
  }

  // Trap Tab / Shift+Tab focus inside the modal while it is open
  if (event.key == "Tab" && searchVisible) {
    var focusable = modal.querySelectorAll(
      'a[href], button, input, [tabindex="0"]',
    );
    if (focusable.length > 0) {
      var firstFocusable = focusable[0];
      var lastFocusable = focusable[focusable.length - 1];
      if (!modal.contains(document.activeElement)) {
        event.preventDefault();
        firstFocusable.focus();
      } else if (event.shiftKey && document.activeElement == firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement == lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  // Down arrow to move down results list
  if (event.key == "ArrowDown") {
    if (searchVisible && hasResults) {
      event.preventDefault();
      if (document.activeElement == input) {
        first.focus();
      } else if (document.activeElement == last) {
        last.focus();
      } else {
        document.activeElement.parentElement.nextSibling.firstElementChild.focus();
      }
    }
  }

  // Up arrow to move up results list
  if (event.key == "ArrowUp") {
    if (searchVisible && hasResults) {
      event.preventDefault();
      if (document.activeElement == input) {
        input.focus();
      } else if (document.activeElement == first) {
        input.focus();
      } else {
        document.activeElement.parentElement.previousSibling.firstElementChild.focus();
      }
    }
  }

  // Enter to get to results
  if (event.key == "Enter") {
    if (searchVisible && document.activeElement == input) {
      event.preventDefault();
    }
    if (searchVisible && hasResults) {
      event.preventDefault();
      if (document.activeElement == input) {
        first.focus();
      } else {
        document.activeElement.click();
      }
    }
  }
});

// Update search on each keypress
input.oninput = function (event) {
  executeQuery(this.value);
};

function displaySearch() {
  if (!indexed) {
    buildIndex();
  }
  if (!searchVisible) {
    previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    wrapper.style.visibility = "visible";
    input.focus();
    searchVisible = true;
  }
}

function hideSearch() {
  if (searchVisible) {
    document.body.style.overflow = "visible";
    wrapper.style.visibility = "hidden";
    input.value = "";
    output.innerHTML = "";
    hasResults = false;
    if (
      previouslyFocused &&
      typeof previouslyFocused.focus === "function" &&
      document.contains(previouslyFocused)
    ) {
      previouslyFocused.focus();
    } else if (document.activeElement) {
      document.activeElement.blur();
    }
    previouslyFocused = null;
    searchVisible = false;
  }
}

function fetchJSON(path, callback, onError) {
  var httpRequest = new XMLHttpRequest();
  httpRequest.onreadystatechange = function () {
    if (httpRequest.readyState === 4) {
      if (httpRequest.status === 200) {
        try {
          var data = JSON.parse(httpRequest.responseText);
        } catch (e) {
          if (onError) onError();
          return;
        }
        if (callback) callback(data);
      } else if (onError) {
        onError();
      }
    }
  };
  httpRequest.open("GET", path);
  httpRequest.send();
}

function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toPlainText(html) {
  return (
    new DOMParser().parseFromString(html || "", "text/html").body
      .textContent || ""
  );
}

function showStatus(message) {
  output.innerHTML =
    '<li role="status" class="p-4">' + escapeHTML(message) + "</li>";
  hasResults = false;
}

function buildIndex() {
  if (indexing) {
    return;
  }
  indexing = true;
  var baseURL = wrapper.getAttribute("data-url");
  baseURL = baseURL.replace(/\/?$/, "/");
  fetchJSON(baseURL + "index.json", function (data) {
    var options = {
      shouldSort: true,
      ignoreLocation: true,
      threshold: 0.0,
      includeMatches: true,
      keys: [
        { name: "title", weight: 0.8 },
        { name: "section", weight: 0.2 },
        { name: "summary", weight: 0.6 },
        { name: "content", weight: 0.4 },
      ],
    };
    /*var finalIndex = [];
    for (var i in data) {
      if(data[i].type != "users" && data[i].type != "tags" && data[i].type != "categories"){
        finalIndex.push(data[i]);
      }
    }*/
    fuse = new Fuse(data, options);
    indexed = true;
    indexing = false;
    if (searchVisible && input.value.trim()) executeQuery(input.value);
  }, function () {
    indexing = false;
    if (searchVisible && input.value.trim()) {
      showStatus("Search is unavailable right now. Please try again.");
    }
  });
}

function executeQuery(term) {
  if (!indexed) {
    buildIndex();
  }
  if (!term.trim()) {
    output.innerHTML = "";
    hasResults = false;
    return;
  }
  if (!fuse) {
    return;
  }
  let results = fuse.search(term);
  let resultsHTML = "";

  if (results.length > 0) {
    results.forEach(function (value, key) {
      var summary = escapeHTML(toPlainText(value.item.summary));
      var title = value.item.externalUrl
        ? escapeHTML(value.item.title) +
          '<span class="text-xs ml-2 align-center cursor-default text-neutral-400 dark:text-neutral-500">' +
          escapeHTML(value.item.externalUrl) +
          "</span>"
        : escapeHTML(value.item.title);
      var linkconfig = value.item.externalUrl
        ? 'target="_blank" rel="noopener" href="' +
          escapeHTML(value.item.externalUrl) +
          '"'
        : 'href="' + escapeHTML(value.item.permalink) + '"';
      resultsHTML =
        resultsHTML +
        `<li class="mb-2">
          <a class="flex items-center px-3 py-2 rounded-md appearance-none bg-neutral-100 dark:bg-neutral-700 focus:bg-primary-100 hover:bg-primary-100 dark:hover:bg-primary-900 dark:focus:bg-primary-900 focus:outline-dotted focus:outline-transparent focus:outline-2" 
          ${linkconfig} tabindex="0">
            <div class="grow">
              <div class="-mb-1 text-lg font-bold">
                ${title}
              </div>
              <div class="text-sm text-neutral-500 dark:text-neutral-400">${escapeHTML(value.item.section)}<span class="px-2 text-primary-500">&middot;</span>${value.item.date ? escapeHTML(value.item.date) : ""}</span></div>
              <div class="text-sm italic">${summary}</div>
            </div>
            <div class="ml-2 ltr:block rtl:hidden text-neutral-500">&rarr;</div>
            <div class="mr-2 ltr:hidden rtl:block text-neutral-500">&larr;</div>
          </a>
        </li>`;
    });
    hasResults = true;
  } else {
    resultsHTML =
      '<li role="status" class="p-4">No matching entries yet. Try another word.</li>';
    hasResults = false;
  }

  output.innerHTML = resultsHTML;
  if (results.length > 0 && output.firstChild) {
    first = output.firstChild.firstElementChild;
    last = output.lastChild.firstElementChild;
  }
}
