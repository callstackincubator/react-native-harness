import { Browser } from 'webdriverio';
import { ElementRef } from '../types.js';

export const isDisplayed = async (session: Browser, elementRef: ElementRef) => {
  return session.isElementDisplayed(elementRef.id);
};

export const isDisabled = async (session: Browser, elementRef: ElementRef) => {
  const result = await isEnabled(session, elementRef);
  return !result;
};

export const isEnabled = async (session: Browser, elementRef: ElementRef) => {
  return session.isElementEnabled(elementRef.id);
};

export const isSelected = async (session: Browser, elementRef: ElementRef) => {
  return session.isElementSelected(elementRef.id);
};
