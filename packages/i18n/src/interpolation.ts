import { I18nError, I18nErrorCode } from "./errors";
import type { TranslationParameters } from "./types";

const TOKEN = /:([A-Za-z][A-Za-z0-9_]{0,63})/gu;
export function interpolate(message: string, parameters: TranslationParameters = Object.freeze({}), strict = false): string {
  try {
    return message.replace(TOKEN, (token, name: string) => {
      if (!Object.prototype.hasOwnProperty.call(parameters, name)) {
        if (strict) throw new I18nError(I18nErrorCode.INTERPOLATION_FAILED, `Missing interpolation parameter "${name}".`);
        return token;
      }
      const value = parameters[name];
      return value === null ? "" : String(value);
    });
  } catch (cause) {
    if (cause instanceof I18nError) throw cause;
    throw new I18nError(I18nErrorCode.INTERPOLATION_FAILED, "Translation interpolation failed.", { cause });
  }
}
