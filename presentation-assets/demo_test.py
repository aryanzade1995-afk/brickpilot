from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto("http://localhost:3000/workspace/existing"); page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Try a demo site").click(); page.wait_for_timeout(1500)
    print("measure:", page.get_by_text("Measure the built structure").count(), flush=True)
    page.get_by_role("button", name="Build my plan").click(); page.wait_for_timeout(8000)
    t = page.inner_text("main"); print("valid plan:", "Valid plan around your structure" in t, flush=True)
    print(errs); b.close()
