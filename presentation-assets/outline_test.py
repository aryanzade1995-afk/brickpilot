from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto("http://localhost:3000/workspace/plan?edit=1"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(3500)
    def size(): return page.locator("[aria-label='Villa size'] p").first.inner_text()
    print("before:", size(), flush=True)
    sel = page.locator("[aria-label='Wall step']"); sel.select_option("900")
    sel.select_option("1500")
    for name in ["East wall in", "South (road) wall in"]:
        btn = page.get_by_role("button", name=name)
        if btn.is_enabled(): btn.click(); page.wait_for_timeout(3000); print(name, "->", size(), "|", page.locator("[role=status]").first.inner_text()[:150].replace(chr(10), " "), flush=True)
        else: print(name, "disabled", flush=True)
    page.locator("[data-testid=plan-editor]").scroll_into_view_if_needed()
    page.screenshot(path=r"C:\Users\aryan\Documents\projects\brick-pilot-final\presentation-assets\outline_probe.png")
    print(errs); b.close()
