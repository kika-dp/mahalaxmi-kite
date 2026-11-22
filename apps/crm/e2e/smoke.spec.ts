import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.SCREENSHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

async function login(page: Page, user: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(user);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('admin signs in, sees live dashboard, creates a product, browses bills', async ({ page }) => {
  await login(page, 'admin01', 'KiteDev@2026#02');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Sales this season')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, 'dashboard');

  await page.getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, 'products');

  await page.getByRole('link', { name: 'Add product' }).click();
  const name = `Playwright Kite ${Date.now()}`;
  await page.getByLabel('Product name').fill(name);
  await page.getByLabel('Category').selectOption({ label: 'Designer Kites' });
  await page.getByLabel('Selling price').fill('25');
  await page.getByLabel('Purchase price (cost)').fill('14');
  await page.getByLabel('Opening stock').fill('40');
  await shot(page, 'product-form');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('In stock:')).toBeVisible();

  await page.getByRole('link', { name: 'Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, 'inventory');

  await page.getByRole('link', { name: 'Bills' }).click();
  await expect(page.getByRole('heading', { name: 'Bills' })).toBeVisible();
  await page.getByRole('button', { name: 'Last 30 days' }).click();
  await page.waitForLoadState('networkidle');
  await shot(page, 'bills');
  const firstBill = page.locator('tbody tr').first();
  if (await firstBill.isVisible()) {
    await firstBill.click();
    await expect(page.getByText('Totals')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await shot(page, 'bill-detail');
  }

  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, 'reports');
});

test('salesperson is turned away from the CRM', async ({ page }) => {
  await login(page, 'seller02', 'KiteDev@2026#05');
  await expect(page.getByText(/Salespeople use the Kite POS app/)).toBeVisible();
  await shot(page, 'login-seller-denied');
});

test('wrong password shows an error', async ({ page }) => {
  await login(page, 'admin02', 'not-the-password-1');
  await expect(page.getByText('Incorrect username or password')).toBeVisible();
});
