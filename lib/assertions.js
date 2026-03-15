/**
 * Evaluate all assertion keys in an assert step.
 * Returns array of failures (empty = all passed).
 *
 * @param {object} assertDef - The assert step definition (all keys to check)
 * @param {import('playwright').Page} page
 * @param {object} ctx - Runner context (previousUrl, etc.)
 * @returns {Promise<Array<{key: string, expected: any, actual: any, message: string}>>}
 */
export async function evaluateAssertions(assertDef, page, ctx) {
  const failures = [];

  const fail = (key, expected, actual, message) => {
    failures.push({ key, expected, actual, message });
  };

  // url — exact match or regex (prefix with ~ for regex)
  if ("url" in assertDef) {
    const current = new URL(page.url()).pathname;
    const expected = assertDef.url;
    if (typeof expected === "string" && expected.startsWith("~")) {
      const regex = new RegExp(expected.slice(1));
      if (!regex.test(current)) {
        fail("url", expected, current, `URL ${current} does not match pattern ${expected}`);
      }
    } else {
      if (current !== expected) {
        fail("url", expected, current, `Expected URL ${expected}, got ${current}`);
      }
    }
  }

  // url_changed — URL is different from before the preceding action
  if ("url_changed" in assertDef && assertDef.url_changed) {
    const current = page.url();
    if (current === ctx.previousUrl) {
      fail("url_changed", true, false, `URL did not change (still ${current})`);
    }
  }

  // title
  if ("title" in assertDef) {
    const actual = await page.title();
    if (actual !== assertDef.title) {
      fail("title", assertDef.title, actual, `Expected title "${assertDef.title}", got "${actual}"`);
    }
  }

  // contains
  if ("contains" in assertDef) {
    const text = await page.locator("body").innerText();
    if (!text.includes(assertDef.contains)) {
      fail("contains", assertDef.contains, null, `Page does not contain "${assertDef.contains}"`);
    }
  }

  // not_contains
  if ("not_contains" in assertDef) {
    const text = await page.locator("body").innerText();
    if (text.includes(assertDef.not_contains)) {
      fail("not_contains", assertDef.not_contains, null, `Page contains "${assertDef.not_contains}" (should not)`);
    }
  }

  // element
  if ("element" in assertDef) {
    const elDef = assertDef.element;
    const locator = page.locator(elDef.selector);
    const count = await locator.count();

    if ("count" in elDef) {
      if (count !== elDef.count) {
        fail("element.count", elDef.count, count, `Expected ${elDef.count} elements matching "${elDef.selector}", found ${count}`);
      }
    }

    if (count === 0 && !("count" in elDef && elDef.count === 0)) {
      fail("element", elDef.selector, null, `Element "${elDef.selector}" not found`);
    } else if (count > 0) {
      const first = locator.first();

      if ("visible" in elDef) {
        const visible = await first.isVisible();
        if (visible !== elDef.visible) {
          fail("element.visible", elDef.visible, visible, `Element "${elDef.selector}" visible=${visible}, expected ${elDef.visible}`);
        }
      }

      if ("text" in elDef) {
        const text = await first.innerText();
        if (text !== elDef.text) {
          fail("element.text", elDef.text, text, `Element "${elDef.selector}" text="${text}", expected "${elDef.text}"`);
        }
      }

      if ("enabled" in elDef) {
        const enabled = await first.isEnabled();
        if (enabled !== elDef.enabled) {
          fail("element.enabled", elDef.enabled, enabled, `Element "${elDef.selector}" enabled=${enabled}, expected ${elDef.enabled}`);
        }
      }

      if ("checked" in elDef) {
        const checked = await first.isChecked();
        if (checked !== elDef.checked) {
          fail("element.checked", elDef.checked, checked, `Element "${elDef.selector}" checked=${checked}, expected ${elDef.checked}`);
        }
      }
    }
  }

  // cookie
  if ("cookie" in assertDef) {
    const cookieDef = assertDef.cookie;
    const cookies = await page.context().cookies();
    const found = cookies.find((c) => c.name === cookieDef.name);
    if ("exists" in cookieDef) {
      if (cookieDef.exists && !found) {
        fail("cookie", cookieDef.name, null, `Cookie "${cookieDef.name}" not found`);
      }
      if (!cookieDef.exists && found) {
        fail("cookie", `no ${cookieDef.name}`, found.name, `Cookie "${cookieDef.name}" exists (should not)`);
      }
    }
  }

  // localStorage
  if ("localStorage" in assertDef) {
    const lsDef = assertDef.localStorage;
    const value = await page.evaluate((key) => localStorage.getItem(key), lsDef.key);
    if ("exists" in lsDef) {
      if (lsDef.exists && value === null) {
        fail("localStorage", lsDef.key, null, `localStorage key "${lsDef.key}" not found`);
      }
      if (!lsDef.exists && value !== null) {
        fail("localStorage", `no ${lsDef.key}`, value, `localStorage key "${lsDef.key}" exists (should not)`);
      }
    }
  }

  // request — check captured network requests
  if ("request" in assertDef) {
    const reqDef = assertDef.request;
    const network = page.__sitecapNetwork || [];
    const match = network.find((r) => r.url.includes(reqDef.url));
    if (!match) {
      fail("request", reqDef.url, null, `No request matching "${reqDef.url}" was captured`);
    } else if ("status" in reqDef && match.status !== reqDef.status) {
      fail("request.status", reqDef.status, match.status, `Request "${reqDef.url}" returned ${match.status}, expected ${reqDef.status}`);
    }
  }

  // no_console_errors
  if ("no_console_errors" in assertDef && assertDef.no_console_errors) {
    const consoleMessages = page.__sitecapConsole || [];
    const errors = consoleMessages.filter((m) => m.type === "error");
    if (errors.length > 0) {
      const msgs = errors.map((e) => e.text).slice(0, 3);
      fail("no_console_errors", 0, errors.length, `${errors.length} console error(s): ${msgs.join("; ")}`);
    }
  }

  // no_network_errors
  if ("no_network_errors" in assertDef && assertDef.no_network_errors) {
    const network = page.__sitecapNetwork || [];
    const errResponses = network.filter((r) => r.status >= 400);
    if (errResponses.length > 0) {
      const msgs = errResponses.map((r) => `${r.status} ${r.url}`).slice(0, 3);
      fail("no_network_errors", 0, errResponses.length, `${errResponses.length} network error(s): ${msgs.join("; ")}`);
    }
  }

  // a11y_complete — no unnamed interactive elements in aria tree
  if ("a11y_complete" in assertDef && assertDef.a11y_complete) {
    const snapshot = await page.locator(":root").ariaSnapshot();
    const interactiveRoles = /- (button|link|textbox|checkbox|radio|combobox|listbox|menuitem)(\s+"([^"]*)")?/;
    const unnamed = [];
    for (const line of snapshot.split("\n")) {
      const match = line.match(interactiveRoles);
      if (match) {
        const name = match[3];
        if (!name || name.trim() === "") {
          unnamed.push(`${match[1]} (unnamed)`);
        }
      }
    }
    if (unnamed.length > 0) {
      const examples = unnamed.slice(0, 3).join(", ");
      fail("a11y_complete", 0, unnamed.length, `${unnamed.length} unnamed interactive element(s): ${examples}`);
    }
  }

  return failures;
}
