from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    page.goto("http://localhost:3000/workspace"); page.evaluate("localStorage.clear()")
    page.goto("http://localhost:3000/workspace/plan?edit=1"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(4000)
    page.locator("[data-room='kitchen']").scroll_into_view_if_needed()
    k = page.locator("[data-room='kitchen']").bounding_box(); d = page.locator("[data-room='living']").bounding_box()
    page.mouse.move(k["x"]+k["width"]/2, k["y"]+k["height"]/2); page.mouse.down(); page.mouse.move(d["x"]+d["width"]/2, d["y"]+d["height"]/2, steps=8); page.wait_for_timeout(300)
    page.screenshot(path=r"C:\Users\aryan\Documents\projects\brick-pilot-final\presentation-assets\dnd_probe.png"); page.mouse.up(); b.close()
