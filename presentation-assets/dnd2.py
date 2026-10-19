import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    page.goto("http://localhost:3000/workspace"); page.evaluate("localStorage.clear()")
    page.goto("http://localhost:3000/workspace/plan?edit=1"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(4000)
    def box(sel): return page.locator(sel).first.bounding_box()
    def c(bb): return bb["x"] + bb["width"]/2, bb["y"] + bb["height"]/2
    def rect(id): return page.locator(f"[data-room='{id}']").evaluate("e => [e.getAttribute('x'), e.getAttribute('y'), e.getAttribute('width'), e.getAttribute('height')].map(Number)")
    def status(): return page.locator("[aria-label='Edit rooms'] [role=status]").first.inner_text()[:220].replace(chr(10), " ")
    cb = box("[data-room='corridor']"); print("corridor", rect("corridor"), "screen", cb, flush=True)
    page.mouse.click(*c(cb)); page.wait_for_timeout(400)
    print("selected:", page.locator("[aria-label='Selected room'] p").first.inner_text())
    e = box("[data-edge='room-W']"); print("W strip", e)
    pxmm = cb["width"] / rect("corridor")[2]
    a = c(e); page.mouse.move(*a); page.mouse.down(); page.mouse.move(a[0] - 300 * pxmm, a[1], steps=6)
    print("ghost:", page.locator("svg text").last.text_content()); page.mouse.up(); page.wait_for_timeout(3500)
    print("result:", status(), "| corridor now", rect("corridor"), "kitchen", rect("kitchen"))
    b.close()
