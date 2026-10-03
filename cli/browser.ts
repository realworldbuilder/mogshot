import { type Browser, chromium, type Page } from '@playwright/test';
import { type Drawn, JOB_PATH, PICTURE_PATH } from './job';

/** Chrome with the drawing page open, kept for a whole batch of pictures. */
export class Darkroom {
  private job: Uint8Array | undefined;
  private picture: Buffer | undefined;

  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  static async open(harnessUrl: string): Promise<Darkroom> {
    let browser: Browser;
    try {
      browser = await chromium.launch({ channel: 'chrome' });
    } catch (cause) {
      throw new Error(`Google Chrome could not be started; pictures are drawn in it. ${cause instanceof Error ? cause.message.split('\n')[0] : ''}`);
    }
    const page = await browser.newPage();
    const room = new Darkroom(browser, page);
    await page.route(`**${JOB_PATH}`, (route) => route.fulfill({ body: Buffer.from(room.job ?? []), contentType: 'application/octet-stream' }));
    await page.route(`**${PICTURE_PATH}`, (route) => {
      room.picture = route.request().postDataBuffer() ?? undefined;
      return route.fulfill({ status: 204 });
    });
    await page.goto(harnessUrl);
    await page.waitForFunction(() => window.mogshot !== undefined);
    return room;
  }

  /** Draw a packed job. Returns the PNG and what the page said about it. */
  async shoot(job: Uint8Array): Promise<Drawn & { png: Buffer }> {
    this.job = job;
    this.picture = undefined;
    const drawn = await this.page.evaluate(() => window.mogshot!.shoot());
    this.job = undefined;
    if (!this.picture) throw new Error('The page drew the picture but did not hand it over');
    return { ...drawn, png: this.picture };
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
