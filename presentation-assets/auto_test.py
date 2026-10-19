import sys
from playwright.sync_api import sync_playwright
PHOTO = sys.argv[1]
OUT = r"C:\Users\aryan\Documents\projects\brick-pilot-final\presentation-assets\auto_probe.png"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    logs = []
    page.on("pageerror", lambda e: logs.append(str(e)[:200]))
    page.goto("http://localhost:3000/workspace/existing"); page.wait_for_load_state("networkidle")
    page.set_input_files("input[type=file]", PHOTO)
    for i in range(120):
        page.wait_for_timeout(2000)
        try: t = page.inner_text("main", timeout=20000)
        except Exception: continue
        if "Measure the built structure" in t or "Review or fix" in t or "could not" in t or "No columns" in t: break
    print("steps:", [x for x in page.locator("main button").all_inner_texts()][:4])
    print(page.locator("[role=status]").all_inner_texts())
    page.screenshot(path=OUT)
    print("errors:", logs)
    b.close()
