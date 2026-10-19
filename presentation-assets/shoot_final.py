import sys, time, os
from playwright.sync_api import sync_playwright

OUT = r"C:\Users\aryan\Documents\projects\brick-pilot-final\presentation-assets\screenshots"
os.makedirs(OUT, exist_ok=True)
BASE = "http://localhost:3000"
saved = []

def shot(page, name, wait=1.5, full=False):
    time.sleep(wait)
    page.mouse.move(0, 0)
    page.screenshot(path=os.path.join(OUT, name), full_page=full)
    saved.append(name)
    print("saved", name, flush=True)

def click_text(page, text, timeout=8000):
    page.get_by_role("button", name=text).first.click(timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe", headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()

    page.goto(BASE + "/start"); page.wait_for_load_state("networkidle")
    shot(page, "01-project-start.png")

    page.goto(BASE + "/workspace"); page.wait_for_load_state("networkidle")
    shot(page, "02-design-brief.png")

    page.goto(BASE + "/workspace/existing"); page.wait_for_load_state("networkidle")
    click_text(page, "Try a demo site")
    page.wait_for_timeout(2500)
    shot(page, "03-existing-structure.png", 1.0)

    try:
        click_text(page, "Confirm all"); page.wait_for_timeout(500)
        click_text(page, "Continue"); page.wait_for_timeout(1500)
        print("step2 text:", page.inner_text("main")[:300].replace("\n", " | "), flush=True)
        shot(page, "03b-calibration.png", 1.0)
        click_text(page, "Build the as-built map"); page.wait_for_timeout(2500)
        shot(page, "04-structural-grid.png", 1.0)
        click_text(page, "Generate the 2D plan"); page.wait_for_timeout(6000)
        shot(page, "05-generated-2d-plan.png", 2.0)
    except Exception as e:
        print("existing flow stopped:", e, flush=True)

    try:
        click_text(page, "Open the 2D plan sheet"); page.wait_for_url("**/workspace/plan**", timeout=15000)
        page.wait_for_load_state("networkidle"); page.wait_for_timeout(3000)
        shot(page, "06-validated-2d-plan.png", 1.0)
        page.goto(BASE + "/workspace/plan?edit=1"); page.wait_for_load_state("networkidle"); page.wait_for_timeout(3000)
        page.get_by_role("button", name="Study / office 1").first.dispatch_event("pointerdown")
        page.wait_for_timeout(800)
        page.locator("[data-testid=plan-editor]").scroll_into_view_if_needed()
        shot(page, "07-plan-review.png", 1.0)
        page.goto(BASE + "/workspace/massing"); page.wait_for_load_state("networkidle")
        # real Blender render: wait for it to finish (up to 5 minutes)
        done = False
        for i in range(60):
            page.wait_for_timeout(5000)
            txt = page.inner_text("main")
            if "GENERATING" not in txt.upper() and "Building and rendering your villa" not in txt:
                done = True; break
        print("blender finished:", done, flush=True)
        page.wait_for_timeout(2000)
        shot(page, "08-3d-exterior.png", 1.0)
        page.locator("main button", has_text="Floor-plan study").click(); page.wait_for_timeout(5000)
        shot(page, "12-product-overview.png", 1.0)
        for name, fn in [("ISO", "09-3d-isometric.png"), ("TOP", "09b-3d-top.png"), ("REAR", "09c-3d-rear.png")]:
            page.locator("main button", has_text=name).first.click(); page.wait_for_timeout(3000)
            shot(page, fn, 0.5)
        page.locator("main button", has_text="ISO").first.click(); page.wait_for_timeout(2000)
        sl = page.locator("input[type=range]").first
        sl.fill("100"); page.wait_for_timeout(3000)
        shot(page, "11-exploded-view.png", 0.5)
        sl.fill("0"); page.wait_for_timeout(1000)
        page.locator("main button", has_text="Furnished").click(); page.wait_for_timeout(5000)
        shot(page, "10-3d-cutaway.png", 1.0)
    except Exception as e:
        print("later flow stopped:", e, flush=True)
    print("DONE", saved)
    b.close()
