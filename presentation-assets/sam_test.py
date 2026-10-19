import time
from playwright.sync_api import sync_playwright
PHOTO = r"C:\Users\aryan\Documents\projects\brick-pilot-final\output\test-photos\14.jpg"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    logs = []
    page.on("console", lambda m: logs.append(m.type + ": " + m.text[:300]))
    page.on("pageerror", lambda e: logs.append("pageerror: " + str(e)[:200]))
    page.goto("http://localhost:3000/workspace/existing"); page.wait_for_load_state("networkidle")
    page.set_input_files("input[type=file]", PHOTO)
    page.wait_for_timeout(25000)
    print("after upload:", page.inner_text("main")[300:900].replace(chr(10), " | "), flush=True)
    page.get_by_role("button", name="Turn on AI measuring").click()
    for i in range(60):
        page.wait_for_timeout(3000)
        if page.get_by_role("button", name="AI: click a column").count(): break
    print("sam ready:", page.get_by_role("button", name="AI: click a column").count(), flush=True)
    if page.get_by_role("button", name="AI: click a column").count():
        img = page.locator("img[alt='Site photo']").bounding_box()
        page.mouse.click(595, 740)
        page.wait_for_timeout(4000)
        print("status:", page.locator("[role=status]").all_inner_texts(), flush=True)
        page.screenshot(path=r"C:\Users\aryan\Documents\projects\brick-pilot-final\presentation-assets\sam_probe.png")
    print([l for l in logs if "opencv" in l.lower() or "error" in l.lower()][:6])
    b.close()
