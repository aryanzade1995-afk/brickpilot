from playwright.sync_api import sync_playwright
OUT = r"C:\Users\aryan\Documents\projects\brick-pilot-final\presentation-assets\dnd_probe.png"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); page = ctx.new_page()
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    # a fresh two-floor design
    page.goto("http://localhost:3000/workspace"); page.evaluate("localStorage.clear()")
    page.goto("http://localhost:3000/workspace/plan?edit=1"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(4000)
    def box(sel):
        page.locator(sel).first.scroll_into_view_if_needed(); return page.locator(sel).first.bounding_box()
    def c(bb): return bb["x"] + bb["width"]/2, bb["y"] + bb["height"]/2
    def drag(a, bpt):
        page.mouse.move(*a); page.mouse.down(); page.mouse.move((a[0]+bpt[0])/2, (a[1]+bpt[1])/2, steps=5); page.mouse.move(*bpt, steps=5); page.mouse.up(); page.wait_for_timeout(3500)
    def status(): return page.locator("[aria-label='Edit rooms'] [role=status]").first.inner_text()[:170].replace(chr(10), " ")
    print("rooms:", page.locator("[data-room]").evaluate_all("els => els.map(e => e.dataset.room)"), flush=True)
    # 1 drag kitchen onto dining = swap
    drag(c(box("[data-room='kitchen']")), c(box("[data-room='dining']"))); print("1 swap kitchen/dining:", status(), flush=True)
    # 2 drag the stair onto the dining room (every floor)
    drag(c(box("[data-room='stair']")), c(box("[data-room='dining']"))); print("2 stair:", status(), flush=True)
    # 3 corridor: select, drag its west edge 300 mm
    page.mouse.click(*c(box("[data-room='corridor']"))); page.wait_for_timeout(400)
    cb = box("[data-room='corridor']"); w = float(page.locator("[data-room='corridor']").get_attribute("width")); h = float(page.locator("[data-room='corridor']").get_attribute("height"))
    vertical = h > w; px = (cb["height"] / h) if vertical else (cb["width"] / w)
    e = box("[data-edge='room-E']") if vertical else box("[data-edge='room-N']"); a = c(e)
    drag(a, (a[0] + 300 * px, a[1]) if vertical else (a[0], a[1] - 300 * px)); print("3 corridor wider:", status(), flush=True)
    # 4 parking: select and drag its west edge
    page.mouse.click(*c(box("[data-room='parking']"))); page.wait_for_timeout(400); print("  selected:", page.locator("[aria-label='Selected room'] p").first.inner_text())
    e = box("[data-edge='room-W']"); a = c(e); drag(a, (a[0] + 20, a[1])); print("4 parking narrower:", status(), flush=True)
    # 5 outer wall via the long strip (nothing selected)
    page.locator("[aria-label^='Plan editor']").focus(); page.keyboard.press("Escape"); page.wait_for_timeout(400)
    sv = page.locator("[data-testid=plan-editor] svg.touch-none"); vb = sv.get_attribute("viewBox").split(); svb = box("[data-testid=plan-editor] svg.touch-none"); pxmm = svb["width"] / float(vb[2])
    e = box("[data-outline='N']"); a = c(e); drag(a, (a[0], a[1] + 300 * pxmm)); print("5 north wall in 0.3 m:", status(), flush=True)
    e = box("[data-outline='E']"); a = c(e); drag(a, (a[0] - 600 * pxmm, a[1])); print("6 east wall in 0.6 m:", status(), flush=True)
    d = box("[data-feature='driveway']"); a = c(d); drag(a, (a[0] - 300 * pxmm, a[1])); print("7 driveway dragged:", status(), flush=True)
    page.locator("[data-testid=plan-editor]").scroll_into_view_if_needed(); page.screenshot(path=OUT)
    print("errors:", errs); b.close()
