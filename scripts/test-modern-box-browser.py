"""Check Modern Box style selection in the running Formstead app.

Requires Python Playwright and its Chromium browser. Optionally set
FORMSTEAD_URL or PLAYWRIGHT_CHANNEL to use an existing server or browser.
"""
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

url = os.environ.get('FORMSTEAD_URL', 'http://localhost:3000')
channel = os.environ.get('PLAYWRIGHT_CHANNEL')
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel=channel)
    page = browser.new_page(viewport={'width': 1440, 'height': 1400})
    style_step = page.get_by_role('button', name=re.compile(r'06.*style', re.I))
    page.goto(url + '/workspace', wait_until='domcontentloaded')
    style_step.click(timeout=60000)

    page.get_by_role('button', name=re.compile('Modern Box', re.I)).first.click()
    cards = page.locator('fieldset').filter(has_text='Choose Your Modern House Design')
    designs = cards.get_by_role('radio')
    expect(designs).to_have_count(4)
    for option in designs.all():
        option.locator('..').click()
        expect(designs.and_(cards.locator(':checked'))).to_have_count(1)
        expect(option).to_be_checked()

    cards.get_by_role('radio', name='Curved Modern').focus()
    page.keyboard.press('ArrowRight')
    expect(cards.get_by_role('radio', name='Asymmetric Roof Modern')).to_be_checked()
    page.reload(wait_until='domcontentloaded')
    style_step.click()
    expect(cards.get_by_role('radio', name='Asymmetric Roof Modern')).to_be_checked()

    image_elements = cards.locator('img')
    for element in image_elements.all():
        element.scroll_into_view_if_needed()
        expect(element).to_be_visible()
    page.wait_for_function(
        "Array.from(document.querySelectorAll('img[src*=modern-house-designs]'))"
        ".filter(img => img.complete && img.naturalWidth > 0).length === 4"
    )
    cards.evaluate("(el) => window.scrollBy(0, el.getBoundingClientRect().top - 175)")
    output = Path('output/modern-box-review')
    output.mkdir(parents=True, exist_ok=True)
    cards.screenshot(path=str(output / 'cards.png'))

    page.get_by_role('button', name=re.compile('Coastal Bungalow', re.I)).first.click()
    expect(cards).to_have_count(0)
    browser.close()

print('Four Modern Box options, images, keyboard selection, reload and non-modern visibility passed.')
