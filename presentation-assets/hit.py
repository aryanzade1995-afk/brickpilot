from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    page.goto("http://localhost:3000/workspace"); page.evaluate("localStorage.clear()")
    page.goto("http://localhost:3000/workspace/plan?edit=1"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(4000)
    page.locator("[data-room=parking]").scroll_into_view_if_needed(); page.wait_for_timeout(500)
    bb = page.locator("[data-room='parking']").bounding_box(); x, y = bb["x"] + bb["width"]/2, bb["y"] + bb["height"]/2
    print(bb, page.evaluate("([x,y]) => { const e = document.elementFromPoint(x,y); return e.tagName + ' ' + [...e.attributes].map(a=>a.name+'='+a.value.slice(0,40)).join(' ') }", [x, y]))
    b.close()
