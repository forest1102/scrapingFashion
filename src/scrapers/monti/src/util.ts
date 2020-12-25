import * as urlPath from 'url'
export const commaToDot = (str?: string) =>
  (str || '')
    .replace(',', '.')

export const addBaseURL = (baseUrl: string) =>
  (relUrl: string) =>
    urlPath.resolve(baseUrl, relUrl)

export const last = (array: any[]) =>
  array[array.length - 1]