import { Browser } from 'webdriverio';

export const getElementHierarchy = async (driver: Browser) => {
  const hierarchy = await driver.getPageSource();
  return hierarchy;
};
