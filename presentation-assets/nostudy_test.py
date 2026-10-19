from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto("http://localhost:3000/workspace/massing"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(3000)
    print("massing tabs:", page.get_by_role("tab").all_inner_texts())
    page.get_by_role("tab", name="Furnished").click(); page.wait_for_timeout(4000)
    print("furnished canvas:", page.locator("canvas").count(), "|", "Furnished ·" in page.inner_text("main"))
    page.goto("http://localhost:3000/workspace/render"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(2000)
    t = page.inner_text("main"); print("render has study:", "Study" in t or "study model" in t.lower(), "| blender heading:", "Your Blender villa" in t)
    print("errors:", errs); b.close()
