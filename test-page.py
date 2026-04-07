from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.goto('http://localhost:5173', timeout=15000)
    page.wait_for_load_state('networkidle', timeout=15000)
    try:
        page.locator('text=跳過導覽').click(timeout=3000)
    except:
        pass
    page.wait_for_timeout(500)

    # Click on supply chain group to show sidebar with many sections
    page.locator('text=供應鏈').click(timeout=3000)
    page.wait_for_timeout(800)

    # Crop sidebar area
    sidebar = page.locator('.sidebar')
    sidebar.screenshot(path='/tmp/sme-sidebar-light.png')

    # Also screenshot the topnav
    topnav = page.locator('.topnav')
    topnav.screenshot(path='/tmp/sme-topnav-light.png')

    browser.close()
