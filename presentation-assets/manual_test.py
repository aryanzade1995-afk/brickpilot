import sys
from playwright.sync_api import sync_playwright
PHOTO = r"C:\Users\aryan\Documents\projects\brick-pilot-final\output\test-photos\14.jpg"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)[:200]))
    page.goto("http://localhost:3000/workspace/existing"); page.wait_for_load_state("networkidle")
    page.set_input_files("input[type=file]", PHOTO)
    for i in range(150):
        page.wait_for_timeout(2000)
        try: t = page.inner_text("main", timeout=20000)
        except Exception: continue
        if "DESCRIBE WHAT IS BUILT" in t.upper() or "Measure the built structure" in t: break
    print("manual form:", "Describe what is built" in t, "| tools gone:", all(x not in t for x in ["Add column", "Add beam", "Seen on site", "Remove"]), flush=True)
    print([x for x in page.locator("[role=status]").all_inner_texts()], flush=True)
    page.screenshot(path=r"C:\Users\aryan\Documents\projects\brick-pilot-final\presentation-assets\manual_probe.png")
    page.get_by_role("button", name="Build my plan").click(); page.wait_for_timeout(9000)
    t = page.inner_text("main"); print("plan valid:", "Valid plan around your structure" in t, "|", t[t.find("Valid plan"):t.find("Valid plan")+200].replace(chr(10), " ") if "Valid plan" in t else t[-300:], flush=True)
    print(errs); b.close()
